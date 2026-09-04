import {
  FlowService,
  ProjectService,
  TaskService,
  WorkflowService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { uuidv7, type Clock, type StatusInterval } from "@morrowlist/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { backfillStatusIntervals } from "../backfill-flow.js";
import type { DatabaseHandle } from "../client.js";
import { taskStatusIntervals, tasks as tasks_ } from "../schema/index.js";
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
let workflow: WorkflowService;

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
  workflow = new WorkflowService({ unitOfWork, clock });
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

describe("workflow editing", () => {
  async function seedProject(name: string) {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name });
    const byCategory = (category: string) => {
      const status = detail.statuses.find((s) => s.category === category);
      if (!status) throw new Error(`no ${category}`);
      return status;
    };
    return { detail, byCategory };
  }
  const shape = (intervals: readonly StatusInterval[]) =>
    intervals.map((interval) => ({
      statusId: interval.statusId,
      category: interval.category,
      enteredAt: interval.enteredAt.toISOString(),
      leftAt: interval.leftAt?.toISOString() ?? null,
    }));
  const summary = (projectId: string) =>
    new FlowService({ unitOfWork, clock }).project(context, workspaceId, projectId, {
      range: "30",
    });

  it("archiving a column with a move closes each stay and opens one in the destination", async () => {
    const { detail, byCategory } = await seedProject("Archive");
    const ready = byCategory("ready");
    const progress = byCategory("in_progress");
    clock.tick();
    const live = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Live",
    });
    const trashed = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Trashed",
    });
    clock.tick();
    const trashedAt = clock.now().toISOString();
    await tasks.delete(context, workspaceId, trashed.id);
    clock.tick(5);
    const archivedAt = clock.now().toISOString();

    await workflow.archive(context, workspaceId, ready.id, {
      destinationStatusId: progress.id,
      newDefaultStatusId: byCategory("backlog").id,
    });

    const entered = live.updatedAt;
    expect(shape(await listForTask(live.id))).toEqual([
      { statusId: ready.id, category: "ready", enteredAt: entered, leftAt: archivedAt },
      {
        statusId: progress.id,
        category: "in_progress",
        enteredAt: archivedAt,
        leftAt: null,
      },
    ]);
    // Trashed work moved with the column but never ages: its stay stays closed.
    expect(shape(await listForTask(trashed.id))).toEqual([
      { statusId: ready.id, category: "ready", enteredAt: entered, leftAt: trashedAt },
    ]);
    const flow = await summary(detail.project.id);
    expect(flow.wip).toBe(1);
    expect(flow.aging.map((item) => item.taskId)).toEqual([live.id]);
  });

  it("a category change across the Done boundary re-enters the column, so the summary sees the completion", async () => {
    const { detail, byCategory } = await seedProject("Recategorise");
    const review = byCategory("review");
    clock.tick();
    const task = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: review.id,
      title: "Under review",
    });
    clock.tick(60);
    const completedAt = clock.now().toISOString();

    await workflow.update(context, workspaceId, review.id, { category: "done" });

    expect(shape(await listForTask(task.id))).toEqual([
      {
        statusId: review.id,
        category: "review",
        enteredAt: task.updatedAt,
        leftAt: completedAt,
      },
      { statusId: review.id, category: "done", enteredAt: completedAt, leftAt: null },
    ]);
    const done = await summary(detail.project.id);
    expect(done).toMatchObject({ wip: 0, completed: 1 });
    expect(done.cycleTimeDays.samples).toBe(1);

    clock.tick();
    await workflow.update(context, workspaceId, review.id, { category: "review" });
    const reopened = await listForTask(task.id);
    expect(reopened.map((interval) => interval.category)).toEqual([
      "review",
      "done",
      "review",
    ]);
    expect(reopened.filter((interval) => interval.leftAt === null)).toHaveLength(1);
    expect(await summary(detail.project.id)).toMatchObject({ wip: 1, completed: 0 });
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

  it("reproduces the rows written around an archive and a category change", async () => {
    clock.tick();
    const detail = await projects.create(context, { workspaceId, name: "Edited" });
    const byCategory = (category: string) => {
      const status = detail.statuses.find((s) => s.category === category);
      if (!status) throw new Error(`no ${category}`);
      return status;
    };
    clock.tick();
    const reviewed = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: byCategory("review").id,
      title: "Reviewed",
    });
    const queued = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: byCategory("ready").id,
      title: "Queued",
    });
    clock.tick();
    // Review becomes a Done column and stays one: the first stay must still read
    // "review" although the column's category today is "done".
    await workflow.update(context, workspaceId, byCategory("review").id, {
      category: "done",
    });
    clock.tick();
    // A task cannot start in a Done column, so this one arrives there by a move.
    const late = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: byCategory("in_progress").id,
      title: "Finished after the flip",
    });
    clock.tick();
    await tasks.move(context, workspaceId, late.id, {
      projectId: detail.project.id,
      statusId: byCategory("review").id,
    });
    clock.tick();
    await workflow.archive(context, workspaceId, byCategory("ready").id, {
      destinationStatusId: byCategory("in_progress").id,
      newDefaultStatusId: byCategory("backlog").id,
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
    expect(
      before.filter((row) => row.taskId === reviewed.id).map((row) => row.category),
    ).toEqual(["review", "done"]);
    expect(
      before.filter((row) => row.taskId === late.id).map((r) => r.category),
    ).toEqual(["in_progress", "done"]);
    expect(
      before.filter((row) => row.taskId === queued.id).map((r) => r.category),
    ).toEqual(["ready", "in_progress"]);

    await handle.db.execute(sql`delete from task_status_intervals`);
    expect(await backfillStatusIntervals(handle.db)).toEqual({
      tasks: 3,
      intervals: before.length,
    });
    const after = await handle.db
      .select()
      .from(taskStatusIntervals)
      .orderBy(taskStatusIntervals.taskId, taskStatusIntervals.enteredAt);
    expect(shape(after)).toEqual(shape(before));
  });
});

describe("flow read budget", () => {
  it("summarises a project with 5,000 completed tasks inside 300 ms", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Busy" });
    const byCategory = (category: string) => {
      const status = detail.statuses.find((s) => s.category === category);
      if (!status) throw new Error(`no ${category}`);
      return status;
    };
    const ready = byCategory("ready");
    const inProgress = byCategory("in_progress");
    const done = byCategory("done");
    const projectId = detail.project.id;

    // Seed rows directly: 5,000 completed tasks, each with four intervals spread over a
    // year, plus 50 open ones, without paying for 20,000 commands through the service.
    const base = START.getTime();
    const taskRows = [];
    const intervalRows = [];
    for (let index = 0; index < 5_050; index++) {
      const id = uuidv7();
      const completed = index < 5_000;
      const created = base + (index % 365) * 86_400_000 + index;
      const startedAt = created + 2 * 86_400_000;
      const doneAt = startedAt + ((index % 9) + 1) * 86_400_000;
      taskRows.push({
        id,
        workspaceId,
        taskNumber: index + 1,
        projectId,
        statusId: completed ? done.id : inProgress.id,
        title: `Task ${index}`,
        priority: "none" as const,
        rank: `a${String(index).padStart(6, "0")}`,
        completedAt: completed ? new Date(doneAt) : null,
        version: 1,
        createdByActorKind: "user" as const,
        createdByActorId: context.actorId,
        lastActorKind: "user" as const,
        lastActorId: context.actorId,
        createdAt: new Date(created),
        updatedAt: new Date(created),
      });
      const stays = [
        [ready.id, "ready", created, startedAt],
        [inProgress.id, "in_progress", startedAt, completed ? doneAt : null],
        ...(completed ? [[done.id, "done", doneAt, null]] : []),
      ] as const;
      for (const [statusId, category, enteredAt, leftAt] of stays) {
        intervalRows.push({
          id: uuidv7(),
          taskId: id,
          workspaceId,
          projectId,
          statusId,
          category,
          enteredAt: new Date(enteredAt),
          leftAt: leftAt === null ? null : new Date(leftAt),
        });
      }
    }
    for (let offset = 0; offset < taskRows.length; offset += 500) {
      await handle.db.insert(tasks_).values(taskRows.slice(offset, offset + 500));
    }
    for (let offset = 0; offset < intervalRows.length; offset += 500) {
      await handle.db
        .insert(taskStatusIntervals)
        .values(intervalRows.slice(offset, offset + 500));
    }

    // Autovacuum analyses a table after this many inserts; the test does not wait for it.
    await handle.db.execute(sql`analyze task_status_intervals`);

    clock.tick(60 * 24 * 400);
    const flow = new FlowService({ unitOfWork, clock });
    const timings: number[] = [];
    let summary = await flow.project(context, workspaceId, projectId, { range: "365" });
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      summary = await flow.project(context, workspaceId, projectId, { range: "365" });
      timings.push(performance.now() - started);
    }

    expect(summary.wip).toBe(50);
    expect(summary.completed).toBeGreaterThan(4_000);
    expect(summary.cycleTimeDays.samples).toBe(summary.completed);
    expect(summary.aging).toHaveLength(50);
    expect(summary.cumulativeFlow).toHaveLength(365);
    expect(Math.max(...timings)).toBeLessThan(300);
  });
});
