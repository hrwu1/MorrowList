import { WEBHOOK_HEADERS, WORKSPACE_EVENTS } from "@morrowlist/contracts";
import { DomainError, fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildActorContext,
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { webhookHeaders, type WebhookRequest, type WebhookSender } from "./sender.js";
import { WEBHOOK_TEST_EVENT, WebhookService } from "./service.js";
import { deriveSigningKey, verifySignature } from "./signature.js";

const NOW = new Date("2026-09-05T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

function stubSender(): WebhookSender & {
  readonly sent: WebhookRequest[];
  respond: (status: number | null) => void;
} {
  const sent: WebhookRequest[] = [];
  let status: number | null = 204;
  return {
    sent,
    respond(next) {
      status = next;
    },
    async send(request) {
      sent.push(request);
      const ok = status !== null && status >= 200 && status < 300;
      return { status, error: ok ? null : `endpoint responded ${status}` };
    },
  };
}

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let sender: ReturnType<typeof stubSender>;
let webhooks: WebhookService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  sender = stubSender();
  webhooks = new WebhookService({
    unitOfWork,
    sender,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
});

const create = (url = "https://receiver.example/hook") =>
  webhooks.create(seeded.context, seeded.workspace.id, { url, eventTypes: ["task.*"] });

describe("WebhookService.create", () => {
  it("returns the secret once and never stores or echoes it again", async () => {
    const created = await create();
    expect(created.secret.startsWith("whsec_")).toBe(true);
    expect(created.secretPrefix).toBe(created.secret.slice(0, 14));

    const stored = unitOfWork.data.webhookSubscriptions.get(created.id)!;
    expect(stored.secretHash).toBe(deriveSigningKey(created.secret));
    expect(JSON.stringify(stored)).not.toContain(created.secret.slice(14));

    const listed = await webhooks.list(seeded.context, seeded.workspace.id, {
      limit: 50,
    });
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret.slice(14));
    expect(listed.data[0]).not.toHaveProperty("secret");
    expect(listed.data[0]).not.toHaveProperty("secretHash");
  });

  it("records an activity row and an outbox row without the secret", async () => {
    const created = await create();

    const activity = unitOfWork.data.activity.at(-1)!;
    expect(activity.eventType).toBe(WORKSPACE_EVENTS.webhookCreated);
    expect(activity.aggregateType).toBe("workspace");
    expect(activity.aggregateId).toBe(seeded.workspace.id);
    expect(activity.summary).toContain("https://receiver.example/hook");
    expect(JSON.stringify(activity)).not.toContain(created.secret.slice(14));

    const outbox = unitOfWork.data.outbox.at(-1)!;
    expect(outbox.eventType).toBe(WORKSPACE_EVENTS.webhookCreated);
    expect(outbox.payload).toEqual({
      subscriptionId: created.id,
      url: created.url,
      eventTypes: ["task.*"],
    });
  });

  it("rolls the subscription and both event rows back together", async () => {
    unitOfWork.failNextCommit();
    await expect(create()).rejects.toThrow();

    expect(unitOfWork.data.webhookSubscriptions.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });
});

describe("WebhookService.update and delete", () => {
  it("records the readable diff and applies only the supplied fields", async () => {
    const created = await create();
    const updated = await webhooks.update(
      seeded.context,
      seeded.workspace.id,
      created.id,
      { active: false, eventTypes: ["task.completed"] },
    );

    expect(updated.active).toBe(false);
    expect(updated.eventTypes).toEqual(["task.completed"]);
    expect(updated.url).toBe(created.url);

    const outbox = unitOfWork.data.outbox.at(-1)!;
    expect(outbox.eventType).toBe(WORKSPACE_EVENTS.webhookUpdated);
    expect(outbox.payload.changes).toEqual({
      active: { from: true, to: false },
      eventTypes: { from: ["task.*"], to: ["task.completed"] },
    });
  });

  it("removes the endpoint and records why", async () => {
    const created = await create();
    await webhooks.delete(seeded.context, seeded.workspace.id, created.id);

    expect(unitOfWork.data.webhookSubscriptions.size).toBe(0);
    expect(unitOfWork.data.activity.at(-1)?.eventType).toBe(
      WORKSPACE_EVENTS.webhookDeleted,
    );
    await expect(
      webhooks.update(seeded.context, seeded.workspace.id, created.id, {
        active: true,
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
  });
});

describe("WebhookService.test", () => {
  it("sends one signed test delivery immediately and logs the result", async () => {
    const created = await create();
    const delivery = await webhooks.test(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );

    expect(delivery).toMatchObject({
      eventType: WEBHOOK_TEST_EVENT,
      status: "delivered",
      responseCode: 204,
      attempt: 1,
      eventId: null,
      nextAttemptAt: null,
    });
    expect(sender.sent).toHaveLength(1);
    const request = sender.sent[0]!;
    expect(
      verifySignature(
        created.secret,
        request.body,
        webhookHeaders(request)[WEBHOOK_HEADERS.signature]!,
        request.timestampSeconds,
      ),
    ).toBe(true);

    const log = await webhooks.listDeliveries(
      seeded.context,
      seeded.workspace.id,
      created.id,
      { limit: 50 },
    );
    expect(log.data.map((entry) => entry.id)).toEqual([delivery.id]);
  });

  it("records a failing test rather than throwing, so the log explains it", async () => {
    const created = await create();
    sender.respond(404);
    const delivery = await webhooks.test(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );

    expect(delivery.status).toBe("failed");
    expect(delivery.responseCode).toBe(404);
    expect(delivery.error).toBe("endpoint responded 404");
  });

  it("refuses to retry a test delivery, which has no event behind it", async () => {
    const created = await create();
    const delivery = await webhooks.test(
      seeded.context,
      seeded.workspace.id,
      created.id,
    );
    await expect(
      webhooks.retryDelivery(
        seeded.context,
        seeded.workspace.id,
        created.id,
        delivery.id,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("workspace isolation", () => {
  it("hides another workspace's endpoints entirely", async () => {
    const created = await create();
    const other = seedWorkspace(unitOfWork.data);

    await expect(
      webhooks.list(other.context, seeded.workspace.id, { limit: 50 }),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    await expect(
      webhooks.update(other.context, other.workspace.id, created.id, { active: false }),
    ).rejects.toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
    await expect(
      webhooks.listDeliveries(other.context, other.workspace.id, created.id, {
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_NOT_FOUND" });
  });

  it("needs workspace:write, so a read-only key cannot manage endpoints", async () => {
    const readOnly = buildActorContext({
      actorKind: "api_key",
      workspaceIds: [seeded.workspace.id],
      scopes: new Set(["tasks:read"]),
    });

    await expect(
      webhooks.list(readOnly, seeded.workspace.id, { limit: 50 }),
    ).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
    await expect(
      webhooks.create(readOnly, seeded.workspace.id, {
        url: "https://receiver.example/hook",
        eventTypes: ["*"],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
