import {
  ProjectService,
  TaskService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { uuidv7, type Clock, type StatusInterval } from "@morrowlist/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { backfillStatusIntervals } from "../backfill-flow.js";
import type { DatabaseHandle } from "../client.js";
import { taskStatusIntervals } from "../schema/index.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Flow read model against real PostgreSQL (GAP-17): every status-changing command
 * closes the previous interval and opens the next in one transaction, the partial unique
 * index keeps a task to one open interval, and the backfill reproduces the same rows
 * from the activity log alone.
 */

const START = new Date("2026-08-01T09:00:00.000Z");

/**
 * A clock that only moves when told to: every `now()` inside one command returns the same
 * instant, exactly as a real transaction sees it, and `tick` separates commands so the
 * intervals have distinct, ordered boundaries.
 */
function manualClock(): Clock & { tick(minutes?: number): void } {
  let offset = 0;
  return {
    now: () => new Date(START.getTime() + offset * 60_000),
    tick(minutes = 1) {
      offset += minutes;
    },
  };
}

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
let clock: ReturnType<typeof manualClock>;
let tasks: TaskService;
let projects: ProjectService;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  clock = manualClock();
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock },
    {
      userId,
      email: "flow-integration@example.com",
      displayName: "Flow Integration",
      timezone: "Europe/Berlin",
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
    requestId: "req_flow_integration",
  };
  tasks = new TaskService({ unitOfWork, clock, cursorSecret: "flow-cursor-secret" });
  projects = new ProjectService({ unitOfWork, clock });
});

function listForTask(taskId: string): Promise<readonly StatusInterval[]> {
  return unitOfWork.execute((tx) =>
    tx.statusIntervals.listForTasks(workspaceId, [taskId]),
  );
}

describe("status intervals", () => {
  it("records one closed interval per stay and one open interval for the current status", async () => {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const byCategory = (category: string) =>
      detail.statuses.find((status) => status.category === category);
    const ready = byCategory("ready");
    const inProgress = byCategory("in_progress");
    const review = byCategory("review");
    if (!ready || !inProgress || !review) throw new Error("workflow incomplete");

    clock.tick();

    const task = await tasks.create(context, {
      workspaceId,
      title: "Ship it",
      projectId: detail.project.id,
      statusId: ready.id,
    });
    for (const status of [inProgress, review]) {
      clock.tick();
      await tasks.move(context, workspaceId, task.id, {
        projectId: detail.project.id,
        statusId: status.id,
      });
    }
    clock.tick();
    await tasks.complete(context, workspaceId, task.id);

    const intervals = await listForTask(task.id);
    expect(intervals.map((interval) => interval.category)).toEqual([
      "ready",
      "in_progress",
      "review",
      "done",
    ]);
    expect(intervals.slice(0, 3).every((interval) => interval.leftAt !== null)).toBe(
      true,
    );
    expect(intervals.at(-1)?.leftAt).toBeNull();
    // Each stay ends exactly when the next begins.
    for (let index = 1; index < intervals.length; index++) {
      expect(intervals[index - 1]?.leftAt?.getTime()).toBe(
        intervals[index]?.enteredAt.getTime(),
      );
    }

    // Reopening keeps the history and starts a new open interval.
    clock.tick();
    await tasks.reopen(context, workspaceId, task.id);
    const reopened = await listForTask(task.id);
    expect(reopened).toHaveLength(5);
    expect(reopened.filter((interval) => interval.leftAt === null)).toHaveLength(1);
    expect(reopened.at(-1)?.category).toBe("review");

    // Trashing closes without opening; restoring opens again; the Inbox has no interval.
    clock.tick();
    await tasks.delete(context, workspaceId, task.id);
    expect((await listForTask(task.id)).every((i) => i.leftAt !== null)).toBe(true);
    clock.tick();
    await tasks.restore(context, workspaceId, task.id);
    expect((await listForTask(task.id)).filter((i) => i.leftAt === null)).toHaveLength(
      1,
    );
    clock.tick();
    await tasks.move(context, workspaceId, task.id, { projectId: null });
    expect((await listForTask(task.id)).every((i) => i.leftAt !== null)).toBe(true);
  });

  it("refuses a second open interval for the same task", async () => {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    if (!ready) throw new Error("workflow incomplete");
    clock.tick();
    const task = await tasks.create(context, {
      workspaceId,
      title: "Single",
      projectId: detail.project.id,
      statusId: ready.id,
    });

    await expect(
      handle.db.insert(taskStatusIntervals).values({
        id: uuidv7(),
        taskId: task.id,
        workspaceId,
        projectId: detail.project.id,
        statusId: ready.id,
        category: "ready",
        enteredAt: clock.now(),
        leftAt: null,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "task_status_intervals_open_key" },
    });
  });

  it("scopes the project read to tasks on the board since the range start, with history", async () => {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    if (!ready) throw new Error("workflow incomplete");
    clock.tick();
    const early = await tasks.create(context, {
      workspaceId,
      title: "Left long ago",
      projectId: detail.project.id,
      statusId: ready.id,
    });
    clock.tick();
    await tasks.move(context, workspaceId, early.id, { projectId: null });
    clock.tick(60 * 24 * 40);
    const since = clock.now();
    clock.tick();
    const recent = await tasks.create(context, {
      workspaceId,
      title: "Recent",
      projectId: detail.project.id,
      statusId: ready.id,
    });
    clock.tick();
    await tasks.complete(context, workspaceId, recent.id);

    const intervals = await unitOfWork.execute((tx) =>
      tx.statusIntervals.listForProject(workspaceId, detail.project.id, since),
    );
    expect(new Set(intervals.map((interval) => interval.taskId))).toEqual(
      new Set([recent.id]),
    );
    expect(intervals.map((interval) => interval.category)).toEqual(["ready", "done"]);
  });
});

describe("backfill", () => {
  it("rebuilds the same intervals from the activity log and skips covered tasks", async () => {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const byCategory = (category: string) => {
      const status = detail.statuses.find((s) => s.category === category);
      if (!status) throw new Error(`no ${category}`);
      return status;
    };
    clock.tick();
    const other = await projects.create(context, { workspaceId, name: "Other" });

    clock.tick();

    const journey = await tasks.create(context, {
      workspaceId,
      title: "Journey",
      projectId: detail.project.id,
      statusId: byCategory("ready").id,
    });
    clock.tick();
    await tasks.move(context, workspaceId, journey.id, {
      projectId: detail.project.id,
      statusId: byCategory("in_progress").id,
    });
    clock.tick();
    await tasks.update(context, workspaceId, journey.id, { title: "Journey renamed" });
    clock.tick();
    await tasks.complete(context, workspaceId, journey.id);
    clock.tick();
    await tasks.reopen(context, workspaceId, journey.id);
    clock.tick();
    await tasks.delete(context, workspaceId, journey.id);
    clock.tick();
    await tasks.restore(context, workspaceId, journey.id);
    clock.tick();
    await tasks.move(context, workspaceId, journey.id, { projectId: other.project.id });

    clock.tick();

    const captured = await tasks.create(context, { workspaceId, title: "Inbox" });
    clock.tick();
    await tasks.move(context, workspaceId, captured.id, {
      projectId: detail.project.id,
      statusId: byCategory("backlog").id,
    });
    clock.tick();
    const untouched = await tasks.create(context, {
      workspaceId,
      title: "Kept",
      projectId: detail.project.id,
      statusId: byCategory("ready").id,
    });

    const before = await handle.db
      .select()
      .from(taskStatusIntervals)
      .orderBy(taskStatusIntervals.taskId, taskStatusIntervals.enteredAt);
    const shape = (rows: (typeof before)[number][]) =>
      rows.map(({ id: _id, ...row }) => ({
        ...row,
        enteredAt: row.enteredAt.toISOString(),
        leftAt: row.leftAt?.toISOString() ?? null,
      }));

    // Lose everything except the untouched task's rows: those must be skipped, not doubled.
    await handle.db.execute(
      sql`delete from task_status_intervals where task_id <> ${untouched.id}::uuid`,
    );
    const result = await backfillStatusIntervals(handle.db);
    const after = await handle.db
      .select()
      .from(taskStatusIntervals)
      .orderBy(taskStatusIntervals.taskId, taskStatusIntervals.enteredAt);

    expect(result).toEqual({ tasks: 2, intervals: before.length - 1 });
    expect(shape(after)).toEqual(shape(before));
    expect(await backfillStatusIntervals(handle.db)).toEqual({
      tasks: 0,
      intervals: 0,
    });
  });
});
