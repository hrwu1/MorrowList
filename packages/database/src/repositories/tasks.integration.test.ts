import {
  ProjectService,
  TaskService,
  bootstrapUser,
  type ActorContext,
} from "@morrowlist/application";
import {
  fixedClock,
  rankBetween,
  updateTaskFields,
  uuidv7,
  type PlainDate,
  type UpdateTaskFieldsInput,
} from "@morrowlist/domain";
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

    expect(listed.data.map((task) => task.id)).toEqual([first.id, second.id, third.id]);
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
          deferUntil: null,
          deadline: null,
          deadlineTime: null,
          parentTaskId: null,
          recurrence: null,
          seriesId: null,
          rank: "a0",
          lastActiveStatusId: null,
          completedAt: null,
          blockedReason: null,
          blockedSince: null,
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

    const { task: reopened } = await service.reopen(context, workspaceId, created.id);
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

describe("trash", () => {
  it("partitions deleted tasks out of normal lists and into the Trash list", async () => {
    // The split is a SQL predicate on deleted_at; an in-memory double cannot prove the
    // generated WHERE clause is the one that runs.
    const kept = await service.create(context, { workspaceId, title: "Kept" });
    const removed = await service.create(context, { workspaceId, title: "Removed" });
    await service.delete(context, workspaceId, removed.id);

    const live = await service.list(context, {
      workspaceId,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    } as never);
    const trash = await service.list(context, {
      workspaceId,
      limit: 50,
      includeSubtasks: true,
      deleted: true,
      sort: "rank",
      order: "asc",
    } as never);

    expect(live.data.map((task) => task.id)).toEqual([kept.id]);
    expect(trash.data.map((task) => task.id)).toEqual([removed.id]);
    expect(trash.data[0]?.deletedAt).toBe(NOW.toISOString());

    const restored = await service.restore(context, workspaceId, removed.id);
    expect(restored.deletedAt).toBeNull();

    const afterRestore = await service.list(context, {
      workspaceId,
      limit: 50,
      includeSubtasks: true,
      deleted: true,
      sort: "rank",
      order: "asc",
    } as never);
    expect(afterRestore.data).toHaveLength(0);
  });
});

describe("subtask tree", () => {
  it("summarises child progress and measures depth on a three-level tree", async () => {
    // Root -> child -> grandchild, plus a sibling of the child that is completed and one
    // that is deleted. The summary is one grouped query for every parent asked for.
    const root = await service.create(context, { workspaceId, title: "Root" });
    const child = await service.create(context, {
      workspaceId,
      title: "Child",
      parentTaskId: root.id,
    });
    const doneSibling = await service.create(context, {
      workspaceId,
      title: "Done sibling",
      parentTaskId: root.id,
    });
    const deletedSibling = await service.create(context, {
      workspaceId,
      title: "Deleted sibling",
      parentTaskId: root.id,
    });
    const grandchild = await service.create(context, {
      workspaceId,
      title: "Grandchild",
      parentTaskId: child.id,
    });
    await service.complete(context, workspaceId, doneSibling.id);
    await service.delete(context, workspaceId, deletedSibling.id);

    const unitOfWork = createUnitOfWork(handle);
    const summary = await unitOfWork.execute((tx) =>
      tx.tasks.childSummary(workspaceId, [root.id, child.id, grandchild.id]),
    );
    expect(summary.get(root.id)).toEqual({ completed: 1, total: 2 });
    expect(summary.get(child.id)).toEqual({ completed: 0, total: 1 });
    expect(summary.has(grandchild.id)).toBe(false);

    const depths = await unitOfWork.execute(async (tx) => ({
      root: await tx.tasks.descendantDepth(workspaceId, root.id),
      child: await tx.tasks.descendantDepth(workspaceId, child.id),
      grandchild: await tx.tasks.descendantDepth(workspaceId, grandchild.id),
      ancestors: await tx.tasks.ancestorIds(workspaceId, grandchild.id),
    }));
    expect(depths).toEqual({
      root: 2,
      child: 1,
      grandchild: 0,
      ancestors: [child.id, root.id],
    });
  });

  it("hides subtasks from the board unless asked to include them", async () => {
    const unitOfWork = createUnitOfWork(handle);
    const { project } = await new ProjectService({
      unitOfWork,
      clock: fixedClock(NOW),
    }).create(context, { workspaceId, name: "Research Launch" });

    const parent = await service.create(context, {
      workspaceId,
      title: "Parent",
      projectId: project.id,
    });
    const subtask = await service.create(context, {
      workspaceId,
      title: "Subtask",
      projectId: project.id,
      parentTaskId: parent.id,
    });

    const hidden = await unitOfWork.execute((tx) =>
      tx.tasks.listBoard({ workspaceId, projectId: project.id }),
    );
    const shown = await unitOfWork.execute((tx) =>
      tx.tasks.listBoard({ workspaceId, projectId: project.id, includeSubtasks: true }),
    );
    expect(hidden.items.map((task) => task.id)).toEqual([parent.id]);
    expect(shown.items.map((task) => task.id).sort()).toEqual(
      [parent.id, subtask.id].sort(),
    );
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

    await expect(service.get(context, workspaceId, secret.id)).rejects.toMatchObject({
      code: "TASK_NOT_FOUND",
    });
    await expect(service.get(context, other.id, secret.id)).rejects.toMatchObject({
      code: "WORKSPACE_NOT_FOUND",
    });
  });
});

describe("defer and deadline dates (GAP-16)", () => {
  // NOW is 11:00 in Europe/Berlin on 29 August.
  const TODAY = "2026-08-29" as PlainDate;
  const day = (offset: number) =>
    new Date(Date.UTC(2026, 7, 29 + offset)).toISOString().slice(0, 10) as PlainDate;

  async function created(title: string, fields: UpdateTaskFieldsInput = {}) {
    const task = await service.create(context, { workspaceId, title });
    if (Object.keys(fields).length === 0) return task;
    await createUnitOfWork(handle).execute(async (tx) => {
      const current = await tx.tasks.findById(workspaceId, task.id);
      if (!current) throw new Error("task vanished");
      const next = updateTaskFields(current, fields, {
        actor: { kind: "user", id: context.actorId },
        clock: fixedClock(NOW),
      });
      await tx.tasks.update(next, current.version);
    });
    return task;
  }

  async function list(filter: Record<string, unknown>) {
    const page = await createUnitOfWork(handle).execute((tx) =>
      tx.tasks.list(
        { workspaceId, today: TODAY, sort: "rank", order: "asc", ...filter },
        { limit: 50 },
      ),
    );
    return page.items.map((task) => task.id);
  }

  it("applies migration 0009: columns, the deadline-time check, and partial indexes", async () => {
    const columns = await handle.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_name = 'tasks' and column_name in ('defer_until', 'deadline', 'deadline_time')
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "deadline", data_type: "date" },
      { column_name: "deadline_time", data_type: "time without time zone" },
      { column_name: "defer_until", data_type: "date" },
    ]);

    const indexes = await handle.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where tablename = 'tasks' and indexname in ('tasks_defer_idx', 'tasks_deadline_idx')
       order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "tasks_deadline_idx",
      "tasks_defer_idx",
    ]);
    for (const row of indexes.rows) {
      expect(row.indexdef).toMatch(/WHERE .*deleted_at IS NULL.*completed_at IS NULL/);
    }

    await expect(
      handle.pool.query(
        `insert into tasks (id, workspace_id, task_number, title, rank, deadline_time,
           priority, version, created_by_actor_kind, created_by_actor_id,
           last_actor_kind, last_actor_id, created_at, updated_at)
         values ($1, $2, 997, 'bad', 'a0', '17:00', 'none', 1, 'user', 'u', 'user', 'u', now(), now())`,
        [uuidv7(), workspaceId],
      ),
    ).rejects.toThrow(/tasks_deadline_time_requires_date/);
  });

  it("round-trips the three dates and the deadline time", async () => {
    const task = await created("Dated", {
      deferUntil: day(-3),
      dueDate: day(2),
      deadline: day(5),
      deadlineTime: "17:30" as never,
    });

    const stored = await createUnitOfWork(handle).execute((tx) =>
      tx.tasks.findById(workspaceId, task.id),
    );
    expect(stored).toMatchObject({
      deferUntil: day(-3),
      dueDate: day(2),
      deadline: day(5),
      deadlineTime: "17:30",
      version: 2,
    });
  });

  it("filters by deferral and by deadline against the workspace date", async () => {
    const deferred = await created("Deferred", { deferUntil: day(7) });
    const returned = await created("Returned", { deferUntil: TODAY });
    const plain = await created("Plain");
    const pastDeadline = await created("Past deadline", { deadline: day(-1) });
    const dueThisWeek = await created("This week", { deadline: day(7) });
    const later = await created("Later", { deadline: day(8) });

    expect(await list({ deferred: true })).toEqual([deferred.id]);
    expect(await list({ deferred: false })).toEqual([
      returned.id,
      plain.id,
      pastDeadline.id,
      dueThisWeek.id,
      later.id,
    ]);
    expect(await list({ deadline: "overdue" })).toEqual([pastDeadline.id]);
    expect(await list({ deadline: "week" })).toEqual([dueThisWeek.id]);
    expect(await list({ deadline: "none" })).toEqual([
      deferred.id,
      returned.id,
      plain.id,
    ]);
  });

  it("keeps a deferred task off the board, Today, and Upcoming until its date", async () => {
    const unitOfWork = createUnitOfWork(handle);
    const { project } = await new ProjectService({
      unitOfWork,
      clock: fixedClock(NOW),
    }).create(context, { workspaceId, name: "Deferral" });
    const card = await service.create(context, {
      workspaceId,
      title: "Card",
      projectId: project.id,
    });
    await created("noop");
    await unitOfWork.execute(async (tx) => {
      const current = await tx.tasks.findById(workspaceId, card.id);
      if (!current) throw new Error("card vanished");
      await tx.tasks.update(
        updateTaskFields(
          current,
          { deferUntil: day(7), dueDate: day(1) },
          { actor: { kind: "user", id: context.actorId }, clock: fixedClock(NOW) },
        ),
        current.version,
      );
    });
    const overdueDeferred = await created("Overdue but deferred", {
      dueDate: day(-1),
      deferUntil: day(7),
    });
    const overdueBack = await created("Overdue and back", {
      dueDate: day(-1),
      deferUntil: TODAY,
    });
    await service.addToDay(context, workspaceId, overdueDeferred.id, { date: TODAY });

    const hidden = await unitOfWork.execute((tx) =>
      tx.tasks.listBoard({ workspaceId, projectId: project.id, today: TODAY }),
    );
    const shown = await unitOfWork.execute((tx) =>
      tx.tasks.listBoard({
        workspaceId,
        projectId: project.id,
        today: TODAY,
        includeDeferred: true,
      }),
    );
    const today = await unitOfWork.execute((tx) =>
      tx.tasks.listToday({ workspaceId, date: TODAY }),
    );
    const upcoming = await unitOfWork.execute((tx) =>
      tx.tasks.listUpcoming({ workspaceId, from: TODAY, to: null }),
    );
    const onTheDay = await unitOfWork.execute((tx) =>
      tx.tasks.listBoard({ workspaceId, projectId: project.id, today: day(7) }),
    );

    expect(hidden.items).toEqual([]);
    expect(shown.items.map((task) => task.id)).toEqual([card.id]);
    // The My Day selection brings the deferred task in; the plain deferred card stays out.
    expect(today.items.map((task) => task.id)).toEqual([
      overdueDeferred.id,
      overdueBack.id,
    ]);
    expect(upcoming.items).toEqual([]);
    expect(onTheDay.items.map((task) => task.id)).toEqual([card.id]);
  });
});
