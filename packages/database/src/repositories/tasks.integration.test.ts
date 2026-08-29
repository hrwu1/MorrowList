import { TaskService, bootstrapUser, type ActorContext } from "@morrowlist/application";
import { fixedClock, rankBetween, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Integration coverage against real PostgreSQL (spec 28.1). These tests exist to catch
 * what in-memory doubles cannot: SQL constraints, the collation the rank algorithm needs,
 * concurrent number allocation, and transactional rollback of activity and outbox rows.
 */

const NOW = new Date("2026-08-29T09:00:00.000Z");
const CURSOR_SECRET = "integration-cursor-secret";

let handle: DatabaseHandle;
let service: TaskService;
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

  const unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "integration@example.com",
      displayName: "Integration",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );

  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Integration",
    workspaceIds: [workspace.id],
    scopes: new Set(),
    requestId: "req_integration",
  };
  service = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
});

describe("task persistence", () => {
  it("creates an Inbox task with a key, rank, and both event rows", async () => {
    const task = await service.create(context, {
      workspaceId,
      title: "Prepare research presentation",
    });

    expect(task.key).toBe("ML-1");
    expect(task.projectId).toBeNull();
    expect(task.version).toBe(1);

    const activity = await handle.pool.query(
      "select event_type, actor_kind, correlation_id from activity_events where aggregate_id = $1",
      [task.id],
    );
    expect(activity.rows).toEqual([
      {
        event_type: "task.created",
        actor_kind: "user",
        correlation_id: "req_integration",
      },
    ]);

    const outbox = await handle.pool.query(
      "select event_type, schema_version, published_at from outbox_events where aggregate_id = $1",
      [task.id],
    );
    expect(outbox.rows[0]).toMatchObject({
      event_type: "task.created",
      schema_version: 1,
      published_at: null,
    });
  });

  it("round-trips every field through PostgreSQL", async () => {
    const created = await service.create(context, {
      workspaceId,
      title: "Full task",
      descriptionMd: "# Notes\n\nSome **markdown**.",
      priority: "urgent",
      dueDate: "2026-09-15",
      dueTime: "14:30",
      dueTimezone: "America/New_York",
    });

    const fetched = await service.get(context, workspaceId, created.id);

    expect(fetched).toMatchObject({
      title: "Full task",
      descriptionMd: "# Notes\n\nSome **markdown**.",
      priority: "urgent",
      dueDate: "2026-09-15",
      // PostgreSQL stores `time` as HH:mm:ss; the mapper returns the wall-clock HH:mm.
      dueTime: "14:30",
      dueTimezone: "America/New_York",
    });
  });

  it("rejects a due time without a due date at the database level", async () => {
    // The check constraint is the backstop if application validation is ever bypassed.
    await expect(
      handle.pool.query(
        `insert into tasks (id, workspace_id, task_number, title, rank, due_time,
           priority, version, created_by_actor_kind, created_by_actor_id,
           last_actor_kind, last_actor_id, created_at, updated_at)
         values ($1, $2, 999, 'bad', 'a0', '09:00', 'none', 1, 'user', 'u', 'user', 'u', now(), now())`,
        [uuidv7(), workspaceId],
      ),
    ).rejects.toThrow(/tasks_due_time_requires_date/);
  });

  it("rejects an Inbox task carrying a status at the database level", async () => {
    await expect(
      handle.pool.query(
        `insert into tasks (id, workspace_id, task_number, title, rank, status_id,
           priority, version, created_by_actor_kind, created_by_actor_id,
           last_actor_kind, last_actor_id, created_at, updated_at)
         values ($1, $2, 998, 'bad', 'a0', $3, 'none', 1, 'user', 'u', 'user', 'u', now(), now())`,
        [uuidv7(), workspaceId, uuidv7()],
      ),
    ).rejects.toThrow(/tasks_inbox_has_no_status|foreign key/);
  });
});

describe("task number allocation", () => {
  it("assigns unique consecutive numbers under concurrency", async () => {
    // Row-level locking is what keeps two simultaneous creates from sharing a number;
    // an in-memory double cannot demonstrate this.
    const created = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        service.create(context, { workspaceId, title: `Task ${i}` }),
      ),
    );

    const numbers = created.map((task) => task.taskNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(25);
    expect(numbers).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});

describe("rank ordering", () => {
  it("orders ranks by code point, not by locale", async () => {
    // Guards migration 0001: under the default en_US.UTF-8 collation PostgreSQL sorts
    // 'aa' before 'aZ', which would reverse two adjacent tasks.
    const ranks = ["a0", "a9", "aZ", "aa", "az", "b0"];
    for (const [index, rank] of ranks.entries()) {
      await handle.pool.query(
        `insert into tasks (id, workspace_id, task_number, title, rank, priority, version,
           created_by_actor_kind, created_by_actor_id, last_actor_kind, last_actor_id,
           created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'none', 1, 'user', 'u', 'user', 'u', now(), now())`,
        [uuidv7(), workspaceId, 100 + index, `Task ${rank}`, rank],
      );
    }

    const { rows } = await handle.pool.query<{ rank: string }>(
      "select rank from tasks where workspace_id = $1 order by rank",
      [workspaceId],
    );

    expect(rows.map((row) => row.rank)).toEqual(ranks);
  });

  it("appends created tasks to the end of the Inbox", async () => {
    const first = await service.create(context, { workspaceId, title: "First" });
    const second = await service.create(context, { workspaceId, title: "Second" });
    const third = await service.create(context, { workspaceId, title: "Third" });

    const listed = await service.list(context, {
      workspaceId,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    } as never);

    expect(listed.data.map((task) => task.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
  });

  it("places a task between two neighbours", async () => {
    const first = await service.create(context, { workspaceId, title: "First" });
    const third = await service.create(context, { workspaceId, title: "Third" });
    const between = rankBetween(first.rank, third.rank);

    expect(first.rank < between).toBe(true);
    expect(between < third.rank).toBe(true);
  });
});

describe("optimistic concurrency", () => {
  it("rejects a stale expected version and leaves the row unchanged", async () => {
    const created = await service.create(context, { workspaceId, title: "Draft" });
    await service.update(context, workspaceId, created.id, { title: "Second" });

    await expect(
      service.update(context, workspaceId, created.id, {
        title: "Third",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: "TASK_VERSION_CONFLICT",
      details: { expectedVersion: 1, actualVersion: 2 },
    });

    const { rows } = await handle.pool.query<{ title: string; version: number }>(
      "select title, version from tasks where id = $1",
      [created.id],
    );
    expect(rows[0]).toEqual({ title: "Second", version: 2 });
  });
});

describe("transactional event recording", () => {
  it("rolls back the task and both event rows when the transaction fails", async () => {
    // EVT-001: a failure must not leave a task without events, or events without a task.
    const unitOfWork = createUnitOfWork(handle);
    await expect(
      unitOfWork.execute(async (tx) => {
        const number = await tx.taskCounters.allocate(workspaceId);
        await tx.tasks.insert({
          id: uuidv7(),
          workspaceId,
          taskNumber: number,
          projectId: null,
          statusId: null,
          title: "Doomed",
          descriptionMd: null,
          priority: "none",
          dueDate: null,
          dueTime: null,
          dueTimezone: null,
          parentTaskId: null,
          rank: "a0",
          lastActiveStatusId: null,
          completedAt: null,
          version: 1,
          createdBy: { kind: "user", id: context.actorId },
          lastActor: { kind: "user", id: context.actorId },
          createdAt: NOW,
          updatedAt: NOW,
          deletedAt: null,
          deletedBy: null,
        });
        await tx.activity.append({
          id: uuidv7(),
          workspaceId,
          aggregateType: "task",
          aggregateId: uuidv7(),
          eventType: "task.created",
          actorKind: "user",
          actorId: context.actorId,
          actorDisplayName: null,
          summary: "never committed",
          payload: {},
          correlationId: "req_rollback",
          createdAt: NOW,
        });
        throw new Error("deliberate failure");
      }),
    ).rejects.toThrow("deliberate failure");

    const tasks = await handle.pool.query("select id from tasks");
    const activity = await handle.pool.query("select id from activity_events");
    expect(tasks.rows).toHaveLength(0);
    // Only the workspace.created event from bootstrap survives.
    expect(activity.rows).toHaveLength(1);
  });
});

describe("completion", () => {
  it("completes and reopens an Inbox task", async () => {
    const created = await service.create(context, { workspaceId, title: "Call bank" });

    const completed = await service.complete(context, workspaceId, created.id);
    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBe(NOW.toISOString());

    const reopened = await service.reopen(context, workspaceId, created.id);
    expect(reopened.completedAt).toBeNull();
    expect(reopened.version).toBe(3);

    const { rows } = await handle.pool.query<{ event_type: string }>(
      "select event_type from activity_events where aggregate_id = $1 order by created_at, id",
      [created.id],
    );
    expect(rows.map((row) => row.event_type)).toEqual([
      "task.created",
      "task.completed",
      "task.reopened",
    ]);
  });
});

describe("workspace isolation", () => {
  it("does not return a task belonging to another workspace", async () => {
    const otherUserId = uuidv7();
    const unitOfWork = createUnitOfWork(handle);
    const { workspace: other } = await bootstrapUser(
      { unitOfWork, clock: fixedClock(NOW) },
      {
        userId: otherUserId,
        email: "other@example.com",
        timezone: "UTC",
        taskKeyPrefix: "OT",
      },
    );

    const otherContext: ActorContext = {
      actorKind: "user",
      actorId: otherUserId,
      userId: otherUserId,
      workspaceIds: [other.id],
      scopes: new Set(),
      requestId: "req_other",
    };
    const secret = await service.create(otherContext, {
      workspaceId: other.id,
      title: "Confidential roadmap",
    });

    await expect(
      service.get(context, workspaceId, secret.id),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
    await expect(
      service.get(context, other.id, secret.id),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });
});
