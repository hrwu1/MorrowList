import {
  ProjectService,
  TaskService,
  bootstrapUser,
  type ActorContext,
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

const NOW = new Date("2026-08-30T12:00:00.000Z");

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
let projects: ProjectService;
let tasks: TaskService;

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
      email: "board-integration@example.com",
      displayName: "Board Integration",
      timezone: "America/New_York",
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
    requestId: "req_board_integration",
  };
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "board-integration-cursor-secret",
  });
});

describe("project board persistence", () => {
  it("creates the default workflow and returns tasks in status/rank order", async () => {
    const detail = await projects.create(context, {
      workspaceId,
      name: "Research Launch",
    });
    const backlog = detail.statuses.find((status) => status.category === "backlog");
    const ready = detail.statuses.find((status) => status.category === "ready");
    const blocked = detail.statuses.find((status) => status.category === "blocked");
    if (!backlog || !ready || !blocked)
      throw new Error("default workflow is incomplete");

    const readyFirst = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Ready first",
    });
    await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Ready second",
    });
    await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: backlog.id,
      title: "Backlog",
    });
    const deleted = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: backlog.id,
      title: "Deleted",
    });
    await tasks.delete(context, workspaceId, deleted.id);
    await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: blocked.id,
      title: "Archived lane",
    });
    await handle.pool.query(
      "update workflow_statuses set archived_at = $1 where id = $2",
      [NOW, blocked.id],
    );

    const board = await projects.board(context, workspaceId, detail.project.id, {
      limit: 2,
    });
    expect(board.data.statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "In Review",
      "Done",
    ]);
    expect(board.data.tasks.map((task) => task.title)).toEqual([
      "Backlog",
      readyFirst.title,
    ]);
    expect(board.page).toEqual({ hasMore: true, truncated: true });

    const completeBoard = await projects.board(context, workspaceId, detail.project.id);
    expect(completeBoard.data.tasks.map((task) => task.title)).toEqual([
      "Backlog",
      "Ready first",
      "Ready second",
    ]);
    expect(completeBoard.data.statuses.some((status) => status.id === blocked.id)).toBe(
      false,
    );
    expect(completeBoard.page).toEqual({ hasMore: false, truncated: false });

    const storedStatuses = await handle.pool.query(
      'select name, is_default from workflow_statuses where project_id = $1 order by rank collate "C"',
      [detail.project.id],
    );
    expect(storedStatuses.rows).toHaveLength(6);
    expect(storedStatuses.rows.filter((row) => row.is_default)).toHaveLength(1);

    const projectEvents = await handle.pool.query(
      "select event_type from activity_events where aggregate_id = $1",
      [detail.project.id],
    );
    expect(projectEvents.rows).toEqual([{ event_type: "project.created" }]);
  });

  it("persists cross-column moves, ordering ranks, completion, and both event rows", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    const review = detail.statuses.find((status) => status.category === "review");
    const done = detail.statuses.find((status) => status.category === "done");
    if (!ready || !review || !done) throw new Error("default workflow is incomplete");

    const first = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: review.id,
      title: "First",
    });
    const last = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: review.id,
      title: "Last",
    });
    const moving = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Moving",
    });

    const { task: reviewed } = await tasks.move(context, workspaceId, moving.id, {
      projectId: detail.project.id,
      statusId: review.id,
      beforeTaskId: first.id,
      afterTaskId: last.id,
      expectedVersion: moving.version,
    });
    expect(reviewed.rank > first.rank && reviewed.rank < last.rank).toBe(true);

    const { task: completed } = await tasks.move(context, workspaceId, moving.id, {
      projectId: detail.project.id,
      statusId: done.id,
      expectedVersion: reviewed.version,
    });
    expect(completed.isCompleted).toBe(true);
    expect(completed.completedAt).toBe(NOW.toISOString());

    const persisted = await handle.pool.query(
      "select status_id, completed_at, version from tasks where id = $1",
      [moving.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      status_id: done.id,
      version: 3,
    });
    expect(persisted.rows[0]?.completed_at).toEqual(NOW);

    const activity = await handle.pool.query(
      "select event_type from activity_events where aggregate_id = $1 order by created_at, id",
      [moving.id],
    );
    expect(activity.rows.map((row) => row.event_type)).toEqual([
      "task.created",
      "task.moved",
      "task.moved",
    ]);
    const outbox = await handle.pool.query(
      "select event_type from outbox_events where aggregate_id = $1 order by occurred_at, id",
      [moving.id],
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual([
      "task.created",
      "task.moved",
      "task.moved",
    ]);
  });

  it("rejects an anchor outside the destination scope transactionally", async () => {
    const detail = await projects.create(context, { workspaceId, name: "Launch" });
    const ready = detail.statuses.find((status) => status.category === "ready");
    const blocked = detail.statuses.find((status) => status.category === "blocked");
    if (!ready || !blocked) throw new Error("default workflow is incomplete");
    const moving = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: ready.id,
      title: "Moving",
    });
    const wrongLane = await tasks.create(context, {
      workspaceId,
      projectId: detail.project.id,
      statusId: blocked.id,
      title: "Wrong lane",
    });

    await expect(
      tasks.move(context, workspaceId, moving.id, {
        projectId: detail.project.id,
        statusId: ready.id,
        beforeTaskId: wrongLane.id,
        expectedVersion: moving.version,
      }),
    ).rejects.toMatchObject({ code: "TASK_VERSION_CONFLICT" });

    const row = await handle.pool.query(
      "select status_id, version from tasks where id = $1",
      [moving.id],
    );
    expect(row.rows[0]).toEqual({ status_id: ready.id, version: 1 });
    const movedEvents = await handle.pool.query(
      "select count(*)::int as count from activity_events where aggregate_id = $1 and event_type = 'task.moved'",
      [moving.id],
    );
    expect(movedEvents.rows[0]).toEqual({ count: 0 });
  });
});
