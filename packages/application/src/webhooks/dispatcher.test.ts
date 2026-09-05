import { WEBHOOK_HEADERS, type WebhookDeliveryEnvelope } from "@morrowlist/contracts";
import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import {
  WEBHOOK_RETRY_DELAYS_MS,
  WebhookDispatcher,
  truncateError,
  type WebhookTickResult,
} from "./dispatcher.js";
import { matchesEventType } from "./mappers.js";
import { webhookHeaders, type WebhookRequest, type WebhookSender } from "./sender.js";
import { WebhookService } from "./service.js";
import { verifySignature } from "./signature.js";

const NOW = new Date("2026-09-05T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

/** A receiver whose answer the test chooses, and which keeps everything it was sent. */
function recordingSender(): WebhookSender & {
  readonly sent: WebhookRequest[];
  respond: (status: number | null, error?: string) => void;
} {
  const sent: WebhookRequest[] = [];
  let status: number | null = 200;
  let error: string | null = null;
  return {
    sent,
    respond(next, reason) {
      status = next;
      error = reason ?? (next === null ? "connect ECONNREFUSED" : `endpoint responded ${next}`);
    },
    async send(request) {
      sent.push(request);
      const ok = status !== null && status >= 200 && status < 300;
      return { status, error: ok ? null : error };
    },
  };
}

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let tasks: TaskService;
let webhooks: WebhookService;
let sender: ReturnType<typeof recordingSender>;
let dispatcher: WebhookDispatcher;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  sender = recordingSender();
  webhooks = new WebhookService({
    unitOfWork,
    sender,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  dispatcher = new WebhookDispatcher({
    unitOfWork,
    sender,
    clock: fixedClock(NOW),
  });
});

/** A subscription created before the events under test, so the fan-out is eligible. */
async function subscribe(eventTypes: string[] = ["*"]) {
  const created = await webhooks.create(seeded.context, seeded.workspace.id, {
    url: "https://receiver.example/hook",
    eventTypes,
  });
  // Backdate it: `listEligible` only sends events that happened after the endpoint existed.
  const stored = unitOfWork.data.webhookSubscriptions.get(created.id)!;
  unitOfWork.data.webhookSubscriptions.set(created.id, {
    ...stored,
    createdAt: new Date(NOW.getTime() - 60_000),
  });
  return created;
}

describe("matchesEventType", () => {
  it("matches an exact type, an aggregate prefix, and the wildcard", () => {
    expect(matchesEventType(["task.completed"], "task.completed")).toBe(true);
    expect(matchesEventType(["task.completed"], "task.created")).toBe(false);
    expect(matchesEventType(["task.*"], "task.created")).toBe(true);
    expect(matchesEventType(["task.*"], "project.created")).toBe(false);
    expect(matchesEventType(["*"], "workspace.webhook_created")).toBe(true);
    expect(matchesEventType([], "task.created")).toBe(false);
  });
});

describe("WebhookDispatcher.tick", () => {
  it("delivers a signed spec 19.6 envelope the subscriber can verify", async () => {
    const subscription = await subscribe();
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Ship the dispatcher",
    });

    const result = await dispatcher.tick(NOW);
    expect(result.queued).toBeGreaterThan(0);
    expect(result.delivered).toBe(result.queued);

    const created = sender.sent.find((request) => request.eventType === "task.created");
    expect(created).toBeDefined();
    const envelope = JSON.parse(created!.body) as WebhookDeliveryEnvelope;
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      type: "task.created",
      aggregateType: "task",
      aggregateId: task.id,
      workspaceId: seeded.workspace.id,
      actor: { kind: "user" },
    });
    expect(envelope.delivery.subscriptionId).toBe(subscription.id);
    expect(envelope.delivery.attempt).toBe(1);
    expect(envelope.payload.taskId).toBe(task.id);

    // The receiver holds the plaintext secret and verifies with it, exactly as documented.
    const headers = webhookHeaders(created!);
    expect(
      verifySignature(
        subscription.secret,
        created!.body,
        headers[WEBHOOK_HEADERS.signature]!,
        created!.timestampSeconds,
      ),
    ).toBe(true);
    expect(headers[WEBHOOK_HEADERS.delivery]).toBe(envelope.delivery.id);
    // Nothing in the outbound headers reveals the secret or the stored key.
    expect(JSON.stringify(headers)).not.toContain(subscription.secret);
    expect(JSON.stringify(headers)).not.toContain(created!.signingKey);
  });

  it("carries the recorded diff on task.updated so a subscriber sees what moved", async () => {
    await subscribe(["task.updated"]);
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Original",
    });
    await tasks.update(seeded.context, seeded.workspace.id, task.id, {
      title: "Renamed",
      priority: "high",
    });

    await dispatcher.tick(NOW);
    expect(sender.sent).toHaveLength(1);
    const envelope = JSON.parse(sender.sent[0]!.body) as WebhookDeliveryEnvelope;
    expect(envelope.type).toBe("task.updated");
    expect(envelope.payload.changes).toEqual({
      title: { from: "Original", to: "Renamed" },
      priority: { from: "none", to: "high" },
    });
  });

  it("sends only the event types a subscription asked for", async () => {
    await subscribe(["task.completed"]);
    const ready = statusByCategory(seeded.statuses, "ready");
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Filtered",
      projectId: seeded.project.id,
      statusId: ready.id,
    });
    await tasks.complete(seeded.context, seeded.workspace.id, task.id);

    await dispatcher.tick(NOW);
    expect(sender.sent.map((request) => request.eventType)).toEqual([
      "task.completed",
    ]);
  });

  it("never replays a backlog at an endpoint added after the fact", async () => {
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Happened first",
    });
    // The clock is fixed, so the "before" is made explicit rather than waited for.
    unitOfWork.data.outbox = unitOfWork.data.outbox.map((event) => ({
      ...event,
      occurredAt: new Date(NOW.getTime() - 60_000),
      availableAt: new Date(NOW.getTime() - 60_000),
    }));
    // Created now, so the event above is older than the subscription.
    await webhooks.create(seeded.context, seeded.workspace.id, {
      url: "https://receiver.example/late",
      eventTypes: ["*"],
    });

    const result = await dispatcher.tick(NOW);
    expect(sender.sent.some((request) => request.eventType === "task.created")).toBe(
      false,
    );
    // The event nobody wanted is published rather than scanned forever.
    expect(result.published).toBeGreaterThan(0);
  });

  it("publishes events immediately when the workspace has no endpoints", async () => {
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Unwatched",
    });

    const first = await dispatcher.tick(NOW);
    expect(first.queued).toBe(0);
    expect(sender.sent).toHaveLength(0);

    const second = await dispatcher.tick(new Date(NOW.getTime() + 1000));
    expect(second.published).toBe(0);
  });

  it("does not send the same event twice, however often it ticks", async () => {
    await subscribe(["task.created"]);
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Once only",
    });

    await dispatcher.tick(NOW);
    const first = sender.sent.length;
    await dispatcher.tick(new Date(NOW.getTime() + 1000));
    await dispatcher.tick(new Date(NOW.getTime() + 2000));
    expect(sender.sent).toHaveLength(first);
  });

  it("retries a failing endpoint at 1 minute, 1 hour and 6 hours, then dead-letters", async () => {
    const subscription = await subscribe(["task.created"]);
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Unreachable",
    });
    sender.respond(500);

    let at = NOW;
    let lastTick: WebhookTickResult | undefined;
    await dispatcher.tick(at);
    expect(sender.sent).toHaveLength(1);

    for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
      const before = sender.sent.length;
      // Nothing is attempted until the backoff has elapsed.
      await dispatcher.tick(new Date(at.getTime() + delay - 1000));
      expect(sender.sent).toHaveLength(before);

      at = new Date(at.getTime() + delay);
      lastTick = await dispatcher.tick(at);
      expect(sender.sent).toHaveLength(before + 1);
    }
    // Dead-lettering settles the event, so it is published and never scanned again.
    expect(lastTick?.deadLettered).toBe(1);
    expect(lastTick?.published).toBe(1);

    // Four attempts: the first plus exactly three retries.
    expect(sender.sent).toHaveLength(4);
    expect(sender.sent.map((request) => request.attempt)).toEqual([1, 2, 3, 4]);

    const log = await webhooks.listDeliveries(
      seeded.context,
      seeded.workspace.id,
      subscription.id,
      { limit: 50 },
    );
    const dead = log.data[0]!;
    expect(dead.status).toBe("failed");
    expect(dead.attempt).toBe(4);
    expect(dead.responseCode).toBe(500);
    expect(dead.nextAttemptAt).toBeNull();

    // A dead delivery stops being attempted, however long the dispatcher keeps running.
    const after = await dispatcher.tick(new Date(at.getTime() + 24 * 3_600_000));
    expect(sender.sent).toHaveLength(4);
    expect(after).toMatchObject({ queued: 0, delivered: 0, failed: 0, published: 0 });
  });

  it("re-delivers a dead-lettered event when someone retries it by hand", async () => {
    const subscription = await subscribe(["task.created"]);
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Recovered",
    });
    sender.respond(503);

    let at = NOW;
    await dispatcher.tick(at);
    for (const delay of WEBHOOK_RETRY_DELAYS_MS) {
      at = new Date(at.getTime() + delay);
      await dispatcher.tick(at);
    }
    const failed = (
      await webhooks.listDeliveries(seeded.context, seeded.workspace.id, subscription.id, {
        limit: 50,
      })
    ).data[0]!;
    expect(failed.status).toBe("failed");

    sender.respond(200);
    const rearmed = await webhooks.retryDelivery(
      seeded.context,
      seeded.workspace.id,
      subscription.id,
      failed.id,
    );
    expect(rearmed.status).toBe("pending");

    await dispatcher.tick(new Date(at.getTime() + 1000));
    expect(sender.sent).toHaveLength(5);
    const delivered = (
      await webhooks.listDeliveries(seeded.context, seeded.workspace.id, subscription.id, {
        limit: 50,
      })
    ).data[0]!;
    expect(delivered.status).toBe("delivered");
    expect(delivered.responseCode).toBe(200);
  });

  it("records a transport failure with no status code", async () => {
    const subscription = await subscribe(["task.created"]);
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "No DNS",
    });
    sender.respond(null, "getaddrinfo ENOTFOUND receiver.example");

    await dispatcher.tick(NOW);
    const log = await webhooks.listDeliveries(
      seeded.context,
      seeded.workspace.id,
      subscription.id,
      { limit: 50 },
    );
    expect(log.data[0]).toMatchObject({
      status: "pending",
      responseCode: null,
      error: "getaddrinfo ENOTFOUND receiver.example",
    });
  });

  it("skips an inactive endpoint", async () => {
    const subscription = await subscribe(["task.created"]);
    await webhooks.update(seeded.context, seeded.workspace.id, subscription.id, {
      active: false,
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Paused",
    });

    await dispatcher.tick(NOW);
    expect(sender.sent).toHaveLength(0);
  });
});

describe("truncateError", () => {
  it("collapses whitespace and caps the stored reason", () => {
    expect(truncateError("  two   lines\nhere ")).toBe("two lines here");
    const long = truncateError("x".repeat(500));
    expect(long).toHaveLength(300);
    expect(long.endsWith("...")).toBe(true);
  });
});
