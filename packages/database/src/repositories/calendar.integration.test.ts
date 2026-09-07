import {
  CalendarFeedService,
  ViewService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
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
  const result = await bootstrapUser(
    { unitOfWork },
    {
      userId,
      email: "calendar@example.com",
      displayName: "Calendar",
      timezone: "America/New_York",
    },
  );
  workspaceId = result.workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "calendar-integration",
  };
});
function feeds(uow = unitOfWork) {
  return new CalendarFeedService({
    unitOfWork: uow,
    signingSecret: "integration-secret",
    appUrl: "https://tasks.example",
  });
}
const tokenOf = (url: string) => new URL(url).pathname.split("/").at(-1)!.slice(0, -4);

describe("Calendar PostgreSQL", () => {
  it("reads 10k canonical tasks with bounded range, all date kinds and tenant isolation", async () => {
    await handle.pool.query(
      `insert into tasks (id, workspace_id, task_number, title, rank, due_date, deadline, defer_until, created_by_actor_kind, created_by_actor_id, last_actor_kind, last_actor_id, created_at, updated_at)
      select gen_random_uuid(), $1, n, 'Scheduled ' || n, 'a' || lpad(n::text, 5, '0'),
      case when n % 3 = 0 then date '2026-09-07' else null end,
      case when n % 3 = 1 then date '2026-09-08' else null end,
      case when n % 3 = 2 then date '2026-09-09' else null end,
      'user', $2, 'user', $2, now(), now() from generate_series(1, 10000) n`,
      [workspaceId, context.userId],
    );
    await handle.pool.query("analyze tasks");
    const service = new ViewService({ unitOfWork });
    const started = performance.now();
    const page = await service.calendar(context, {
      workspaceId,
      from: "2026-09-07",
      to: "2026-09-09",
    });
    const elapsed = performance.now() - started;
    expect(page.data.tasks).toHaveLength(2000);
    expect(page.data.truncated).toBe(true);
    expect(page.data.tasks.every((task) => task.workspaceId === workspaceId)).toBe(
      true,
    );
    const empty = await service.calendar(context, {
      workspaceId,
      from: "2026-09-10",
      to: "2026-09-11",
    });
    expect(empty.data.tasks).toHaveLength(0);
    // Broad enough for busy CI; logged timing is measurement, not a production SLA.
    expect(elapsed).toBeLessThan(5000);
    console.info(
      `Calendar 10k fixture: ${Math.round(elapsed)}ms, 2000 DTOs, truncation explicit`,
    );
    await expect(
      service.calendar(
        { ...context, workspaceIds: [] },
        { workspaceId, from: "2026-09-07", to: "2026-09-09" },
      ),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
  it("rotates concurrently to one active token and revokes immediately", async () => {
    const service = feeds();
    const created = await Promise.all([
      service.create(context, workspaceId),
      service.create(context, workspaceId),
    ]);
    const values = await Promise.all(
      created.map((feed) => service.feed(tokenOf(feed.url))),
    );
    expect(values.filter((value) => value !== null)).toHaveLength(1);
    await service.revoke(context, workspaceId);
    for (const feed of created)
      expect(await service.feed(tokenOf(feed.url))).toBeNull();
    expect(
      (await handle.pool.query("select * from calendar_feed_tokens")).rowCount,
    ).toBe(1);
  });
  it("rolls back the token and activity if the outbox rejects", async () => {
    const before = await handle.pool.query(
      "select count(*)::int as count from activity_events",
    );
    const broken: UnitOfWork = {
      execute: (fn) =>
        unitOfWork.execute((tx) =>
          fn({
            ...tx,
            outbox: {
              ...tx.outbox,
              enqueue: async () => {
                throw new Error("outbox failed");
              },
            },
          }),
        ),
    };
    await expect(feeds(broken).create(context, workspaceId)).rejects.toThrow(
      "outbox failed",
    );
    expect(
      (await handle.pool.query("select * from calendar_feed_tokens")).rowCount,
    ).toBe(0);
    expect(
      (await handle.pool.query("select count(*)::int as count from activity_events"))
        .rows,
    ).toEqual(before.rows);
  });
});
