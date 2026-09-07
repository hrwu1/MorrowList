import {
  InboundEmailService,
  bootstrapUser,
  parseInboundEmail,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { uuidv7 } from "@morrowlist/domain";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";
let handle: DatabaseHandle,
  uow: UnitOfWork,
  service: InboundEmailService,
  context: ActorContext,
  workspaceId: string;
const options = {
  domain: "inbox.example.com",
  webhookSecret: "test-inbound-secret",
  addressSecret: "test-address-secret",
};
beforeAll(async () => {
  handle = await setupTestDatabase();
});
afterAll(teardownTestDatabase);
beforeEach(async () => {
  await truncateAll(handle);
  uow = createUnitOfWork(handle);
  const userId = uuidv7();
  const result = await bootstrapUser(
    { unitOfWork: uow },
    { userId, email: "inbound@example.com", timezone: "UTC" },
  );
  workspaceId = result.workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "integration",
  };
  service = new InboundEmailService({ ...options, unitOfWork: uow });
});
const message = (recipient: string) =>
  parseInboundEmail("normalized", {
    recipient,
    messageId: "delivery-1",
    subject: "Call Sam tomorrow",
    text: "Notes",
  });
it("migration 0016 serializes concurrent retries and rotations, enforces one current address", async () => {
  const inbox = (await service.rotateAddress(context, workspaceId)).address!;
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      service.receive("normalized", message(inbox), "concurrent"),
    ),
  );
  expect(new Set(results.map((r) => r.taskId)).size).toBe(1);
  expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
  const counts = await handle.pool.query(
    "SELECT (SELECT count(*)::int FROM tasks) tasks, (SELECT count(*)::int FROM inbound_receipts) receipts, (SELECT count(*)::int FROM outbox_events WHERE event_type = 'task.created') events",
  );
  expect(counts.rows[0]).toEqual({ tasks: 1, receipts: 1, events: 1 });
  await Promise.all([
    service.rotateAddress(context, workspaceId),
    service.rotateAddress(context, workspaceId),
  ]);
  expect(
    (
      await handle.pool.query(
        "SELECT count(*)::int AS n FROM inbound_addresses WHERE revoked_at IS NULL",
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(service.receive("normalized", message(inbox), "old")).rejects.toThrow();
});
it("rolls back SQL task, receipt and activity on outbox failure; rotation rollback preserves old token", async () => {
  const inbox = (await service.rotateAddress(context, workspaceId)).address!;
  const failing: UnitOfWork = {
    execute: (fn) =>
      uow.execute((tx) =>
        fn({
          ...tx,
          outbox: {
            ...tx.outbox,
            enqueue: async () => {
              throw new Error("outbox failure");
            },
          },
        }),
      ),
  };
  const failedService = new InboundEmailService({ ...options, unitOfWork: failing });
  await expect(
    failedService.receive("normalized", message(inbox), "fail"),
  ).rejects.toThrow("outbox failure");
  expect(
    (await handle.pool.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n,
  ).toBe(0);
  expect(
    (await handle.pool.query("SELECT count(*)::int AS n FROM inbound_receipts")).rows[0]
      .n,
  ).toBe(0);
  expect(
    (
      await handle.pool.query(
        "SELECT count(*)::int AS n FROM activity_events WHERE event_type = 'task.created'",
      )
    ).rows[0].n,
  ).toBe(0);
  await expect(failedService.rotateAddress(context, workspaceId)).rejects.toThrow(
    "outbox failure",
  );
  expect((await service.getAddress(context, workspaceId)).address).toBe(inbox);
});
