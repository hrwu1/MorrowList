import {
  IdempotencyService,
  TaskService,
  bootstrapUser,
  type ActorContext,
} from "@morrowlist/application";
import { fixedClock, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

const NOW = new Date("2026-09-12T00:00:00Z");
let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;

beforeAll(async () => {
  handle = await setupTestDatabase();
});
afterAll(teardownTestDatabase);
beforeEach(async () => {
  await truncateAll(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork: createUnitOfWork(handle) },
    {
      userId,
      email: "replay@example.com",
      displayName: "Replay",
      timezone: "UTC",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "replay-integration",
  };
});

function executor() {
  const unitOfWork = createUnitOfWork(handle);
  const replay = new IdempotencyService({ unitOfWork, clock: fixedClock(NOW) });
  const tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "replay-test-cursor",
  });
  return { replay, tasks, unitOfWork };
}
const input = (key = "key") => ({
  workspaceId,
  scopeHash: "scope",
  keyHash: key,
  fingerprint: "body",
});

it("serializes duplicate requests across independent UnitOfWork instances", async () => {
  const first = executor();
  const second = executor();
  const run = ({ replay, tasks }: ReturnType<typeof executor>) =>
    replay.execute(context, input(), async () => {
      const task = await tasks.create(context, {
        workspaceId,
        title: "One logical command",
      });
      return task.id;
    });
  const [a, b] = await Promise.all([run(first), run(second)]);
  expect(a).toBe(b);
  const { rows } = await handle.pool.query(`select
    (select count(*)::int from tasks) as tasks,
    (select count(*)::int from activity_events where event_type = 'task.created') as activity,
    (select count(*)::int from outbox_events where event_type = 'task.created') as outbox,
    (select count(*)::int from idempotency_records) as replay`);
  expect(rows[0]).toEqual({ tasks: 1, activity: 1, outbox: 1, replay: 1 });
});

it("replays a user-scoped mutation without any workspace membership", async () => {
  await handle.pool.query("delete from workspace_members where user_id = $1", [
    context.actorId,
  ]);
  const actor: ActorContext = { ...context, workspaceIds: [] };
  const request = { ...input("user-key"), workspaceId: null };
  const endpoint = "https://push.example/user-device";
  let executions = 0;
  const run = ({ replay, unitOfWork }: ReturnType<typeof executor>) =>
    replay.execute(actor, request, async () => {
      executions++;
      await unitOfWork.execute((tx) =>
        tx.pushSubscriptions.upsert({
          userId: actor.actorId,
          endpoint,
          keys: { p256dh: "test-public-key", auth: "test-auth-key" },
          createdAt: NOW,
        }),
      );
      // Encryption belongs to the HTTP adapter; the application stores an opaque value.
      return "opaque-user-response";
    });

  const results = await Promise.all([run(executor()), run(executor())]);
  expect(results).toEqual(["opaque-user-response", "opaque-user-response"]);
  expect(executions).toBe(1);
  const { rows } = await handle.pool.query(`select
    (select count(*)::int from workspace_members) as memberships,
    (select count(*)::int from push_subscriptions) as registrations,
    (select count(*)::int from idempotency_records) as replay,
    (select workspace_id from idempotency_records) as workspace`);
  expect(rows[0]).toEqual({
    memberships: 0,
    registrations: 1,
    replay: 1,
    workspace: null,
  });
});

it("rolls back nested task and event writes if saving replay fails", async () => {
  const { replay, tasks } = executor();
  // Oversized scope forces the replay insert to fail after the task was written.
  await expect(
    replay.execute(context, { ...input(), scopeHash: "x".repeat(65) }, async () => {
      const task = await tasks.create(context, {
        workspaceId,
        title: "Must roll back",
      });
      return task.id;
    }),
  ).rejects.toThrow();
  const { rows } = await handle.pool.query(`select
    (select count(*)::int from tasks) as tasks,
    (select count(*)::int from outbox_events where event_type = 'task.created') as outbox,
    (select count(*)::int from idempotency_records) as replay`);
  expect(rows[0]).toEqual({ tasks: 0, outbox: 0, replay: 0 });
  const result = await replay.execute(
    context,
    input(),
    async () =>
      (await tasks.create(context, { workspaceId, title: "Retry succeeds" })).id,
  );
  expect(result).toBeTruthy();
});

it("keeps concurrent unrelated commands isolated and rejects key reuse", async () => {
  const first = executor();
  const second = executor();
  await Promise.all(
    [first, second].map(({ replay, tasks }, index) =>
      replay.execute(context, input(`key-${index}`), async () => {
        return (await tasks.create(context, { workspaceId, title: `Command ${index}` }))
          .id;
      }),
    ),
  );
  expect(
    (await handle.pool.query("select count(*)::int as count from tasks")).rows[0].count,
  ).toBe(2);
  await expect(
    first.replay.execute(
      context,
      { ...input("key-0"), fingerprint: "changed" },
      async () => "unexpected",
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
});
