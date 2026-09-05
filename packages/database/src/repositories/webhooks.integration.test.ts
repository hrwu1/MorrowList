import {
  TaskService,
  WebhookDispatcher,
  WebhookService,
  bootstrapUser,
  verifySignature,
  webhookHeaders,
  type ActorContext,
  type UnitOfWork,
  type WebhookRequest,
  type WebhookSender,
} from "@morrowlist/application";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Webhook persistence and dispatch against real PostgreSQL (GAP-18). Migration 0012
 * carries the unique index that makes fan-out idempotent, the partial index the claim
 * relies on, a status check constraint, and cascading foreign keys — none of which the
 * in-memory doubles can demonstrate.
 */

const NOW = new Date("2026-09-05T09:00:00.000Z");
const CURSOR_SECRET = "webhooks-integration-cursor-secret";

function recordingSender(): WebhookSender & {
  readonly sent: WebhookRequest[];
  respond: (status: number | null) => void;
} {
  const sent: WebhookRequest[] = [];
  let status: number | null = 200;
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

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
let tasks: TaskService;
let webhooks: WebhookService;
let sender: ReturnType<typeof recordingSender>;
let dispatcher: WebhookDispatcher;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "webhooks-integration@example.com",
      displayName: "Webhooks Integration",
      timezone: "UTC",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_webhooks_integration",
  };
  tasks = new TaskService({ unitOfWork, clock: fixedClock(NOW), cursorSecret: CURSOR_SECRET });
  sender = recordingSender();
  webhooks = new WebhookService({
    unitOfWork,
    sender,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  dispatcher = new WebhookDispatcher({ unitOfWork, sender, clock: fixedClock(NOW) });
});

/** An endpoint that already existed when the events under test happened. */
async function subscribe(eventTypes: string[] = ["task.created"]) {
  const created = await webhooks.create(context, workspaceId, {
    url: "https://receiver.example/hook",
    eventTypes,
  });
  await handle.pool.query(
    `update webhook_subscriptions set created_at = $1 where id = $2`,
    [new Date(NOW.getTime() - 60_000), created.id],
  );
  return created;
}

describe("webhook subscriptions", () => {
  it("stores only the digest of the secret", async () => {
    const created = await subscribe();
    const { rows } = await handle.pool.query<{ secret_hash: string }>(
      `select secret_hash from webhook_subscriptions where id = $1`,
      [created.id],
    );
    expect(rows[0]?.secret_hash).toHaveLength(64);
    expect(rows[0]?.secret_hash).not.toContain(created.secret);
  });

  it("rejects a delivery status the application does not know", async () => {
    const created = await subscribe();
    await expect(
      handle.pool.query(
        `insert into webhook_deliveries
           (id, workspace_id, subscription_id, outbox_event_id, event_type, status,
            attempt, created_at, updated_at)
         values ($1, $2, $3, null, 'task.created', 'nonsense', 0, now(), now())`,
        [uuidv7(), workspaceId, created.id],
      ),
    ).rejects.toThrow(/webhook_deliveries_status/);
  });

  it("takes its deliveries with it when the endpoint is removed", async () => {
    const created = await subscribe();
    await tasks.create(context, { workspaceId, title: "Cascade" });
    await dispatcher.tick(NOW);

    await webhooks.delete(context, workspaceId, created.id);
    const { rows } = await handle.pool.query(`select id from webhook_deliveries`);
    expect(rows).toHaveLength(0);
  });
});

describe("WebhookDispatcher against PostgreSQL", () => {
  it("delivers a verifiable envelope and publishes the outbox row", async () => {
    const created = await subscribe();
    const task = await tasks.create(context, { workspaceId, title: "Integration" });

    const result = await dispatcher.tick(NOW);
    expect(result).toMatchObject({ queued: 1, delivered: 1, published: 1 });

    const request = sender.sent[0]!;
    const envelope = JSON.parse(request.body) as {
      type: string;
      aggregateId: string;
      payload: Record<string, unknown>;
    };
    expect(envelope.type).toBe("task.created");
    expect(envelope.aggregateId).toBe(task.id);
    expect(envelope.payload.taskId).toBe(task.id);

    // Verified the way a subscriber would: with the secret it was shown, not the digest.
    // The header name is fixed by WEBHOOK_HEADERS in @morrowlist/contracts.
    const signature = webhookHeaders(request)["Morrow-Signature"]!;
    expect(
      verifySignature(created.secret, request.body, signature, request.timestampSeconds),
    ).toBe(true);

    const { rows } = await handle.pool.query<{ published_at: Date | null }>(
      `select published_at from outbox_events where event_type = 'task.created'`,
    );
    expect(rows[0]?.published_at).not.toBeNull();
  });

  it("never enqueues the same (endpoint, event) pair twice", async () => {
    await subscribe();
    await tasks.create(context, { workspaceId, title: "Idempotent" });

    await dispatcher.tick(NOW);
    // Two more ticks, including one that would race a second dispatcher.
    await Promise.all([
      dispatcher.tick(new Date(NOW.getTime() + 1000)),
      dispatcher.tick(new Date(NOW.getTime() + 1000)),
    ]);

    const { rows } = await handle.pool.query(`select id from webhook_deliveries`);
    expect(rows).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });

  it("claims each due attempt exactly once across concurrent dispatchers", async () => {
    await subscribe(["task.*"]);
    for (let index = 0; index < 5; index += 1) {
      await tasks.create(context, { workspaceId, title: `Concurrent ${index}` });
    }

    const second = new WebhookDispatcher({
      unitOfWork,
      sender,
      clock: fixedClock(NOW),
    });
    await dispatcher.tick(NOW);
    await Promise.all([
      dispatcher.tick(new Date(NOW.getTime() + 1000)),
      second.tick(new Date(NOW.getTime() + 1000)),
    ]);

    expect(sender.sent).toHaveLength(5);
    const { rows } = await handle.pool.query<{ status: string; attempt: number }>(
      `select status, attempt from webhook_deliveries`,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.status === "delivered" && row.attempt === 1)).toBe(
      true,
    );
  });

  it("dead-letters after three retries and re-delivers on a manual retry", async () => {
    const created = await subscribe();
    await tasks.create(context, { workspaceId, title: "Down" });
    sender.respond(500);

    let at = NOW;
    await dispatcher.tick(at);
    for (const delay of [60_000, 3_600_000, 6 * 3_600_000]) {
      at = new Date(at.getTime() + delay);
      await dispatcher.tick(at);
    }
    expect(sender.sent).toHaveLength(4);

    const failed = (
      await webhooks.listDeliveries(context, workspaceId, created.id, { limit: 50 })
    ).data[0]!;
    expect(failed).toMatchObject({ status: "failed", attempt: 4, responseCode: 500 });

    sender.respond(200);
    await webhooks.retryDelivery(context, workspaceId, created.id, failed.id);
    await dispatcher.tick(new Date(at.getTime() + 1000));

    expect(sender.sent).toHaveLength(5);
    const recovered = (
      await webhooks.listDeliveries(context, workspaceId, created.id, { limit: 50 })
    ).data[0]!;
    expect(recovered).toMatchObject({ status: "delivered", responseCode: 200 });
  });

  it("pages the delivery log newest first", async () => {
    const created = await subscribe(["task.*"]);
    for (let index = 0; index < 5; index += 1) {
      await tasks.create(context, { workspaceId, title: `Log ${index}` });
    }
    await dispatcher.tick(NOW);

    const first = await webhooks.listDeliveries(context, workspaceId, created.id, {
      limit: 2,
    });
    expect(first.data).toHaveLength(2);
    expect(first.page.hasMore).toBe(true);

    const second = await webhooks.listDeliveries(context, workspaceId, created.id, {
      limit: 10,
      cursor: first.page.nextCursor!,
    });
    expect(second.data).toHaveLength(3);
    expect(second.page.hasMore).toBe(false);
    const ids = [...first.data, ...second.data].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort().reverse()).toEqual(ids);
  });
});
