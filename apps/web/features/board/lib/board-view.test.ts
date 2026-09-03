import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  moveTaskInBoard,
  placementChangesTask,
  placementForDrop,
  readBoardStageView,
  readBoardSort,
  sortBoardTasks,
  tasksInStatus,
  visibleBoardStatuses,
} from "./board-view";

const BASE_TASK: TaskDto = {
  id: "0198f0a0-0000-7000-8000-000000000001",
  key: "ML-1",
  workspaceId: "0198f0a0-0000-7000-8000-000000000010",
  taskNumber: 1,
  projectId: "0198f0a0-0000-7000-8000-000000000020",
  statusId: "0198f0a0-0000-7000-8000-000000000030",
  title: "First",
  descriptionMd: null,
  priority: "none",
  dueDate: null,
  dueTime: null,
  dueTimezone: null,
  parentTaskId: null,
  rank: "a0",
  isCompleted: false,
  completedAt: null,
  version: 1,
  createdBy: { kind: "user", id: "user-1" },
  lastActor: { kind: "user", id: "user-1" },
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  deletedAt: null,
  dayPlans: [],
};

const READY = "0198f0a0-0000-7000-8000-000000000030";
const DONE = "0198f0a0-0000-7000-8000-000000000031";
const BACKLOG = "0198f0a0-0000-7000-8000-000000000032";
const IN_PROGRESS = "0198f0a0-0000-7000-8000-000000000033";
const BLOCKED = "0198f0a0-0000-7000-8000-000000000034";
const REVIEW = "0198f0a0-0000-7000-8000-000000000035";
const task = (id: string, overrides: Partial<TaskDto> = {}): TaskDto => ({
  ...BASE_TASK,
  id,
  taskNumber: Number(id.at(-1) ?? "1"),
  key: `ML-${id.at(-1)}`,
  ...overrides,
});

const status = (
  id: string,
  overrides: Partial<WorkflowStatusDto> = {},
): WorkflowStatusDto => ({
  id,
  projectId: BASE_TASK.projectId!,
  name: "Ready",
  category: "ready",
  rank: "a0",
  colorToken: "blue",
  wipLimit: null,
  isDefault: true,
  isTerminal: false,
  archivedAt: null,
  version: 1,
  ...overrides,
});

describe("board view", () => {
  it("reads known board URL choices and safely ignores unknown values", () => {
    expect(readBoardSort(new URLSearchParams("sort=surprise"))).toBe("manual");
    expect(readBoardSort(new URLSearchParams("sort=due"))).toBe("due");
    expect(readBoardSort(new URLSearchParams("sort=priority"))).toBe("priority");
    expect(readBoardStageView(new URLSearchParams())).toBe("focus");
    expect(readBoardStageView(new URLSearchParams("show=surprise"))).toBe("focus");
    expect(readBoardStageView(new URLSearchParams("show=ALL"))).toBe("focus");
    expect(readBoardStageView(new URLSearchParams("show=all"))).toBe("all");
  });

  it("keeps the four core stages and reveals only occupied exception stages", () => {
    const statuses = [
      status(BACKLOG, { name: "Backlog", category: "backlog" }),
      status(READY),
      status(IN_PROGRESS, { name: "In Progress", category: "in_progress" }),
      status(BLOCKED, { name: "Blocked", category: "blocked" }),
      status(REVIEW, { name: "In Review", category: "review" }),
      status(DONE, { name: "Done", category: "done", isTerminal: true }),
    ];

    expect(
      visibleBoardStatuses(statuses, [], "focus").map(({ category }) => category),
    ).toEqual(["backlog", "ready", "in_progress", "done"]);

    const exceptionTasks = [
      task("0198f0a0-0000-7000-8000-000000000006", { statusId: BLOCKED }),
      task("0198f0a0-0000-7000-8000-000000000007", { statusId: REVIEW }),
    ];
    expect(
      visibleBoardStatuses(statuses, exceptionTasks, "focus").map(
        ({ category }) => category,
      ),
    ).toEqual(["backlog", "ready", "in_progress", "blocked", "review", "done"]);
  });

  it("shows every stage on request without changing workflow order", () => {
    const statuses = [
      status(BACKLOG, { name: "Backlog", category: "backlog" }),
      status(BLOCKED, { name: "Blocked", category: "blocked" }),
      status(REVIEW, { name: "In Review", category: "review" }),
      status(DONE, { name: "Done", category: "done", isTerminal: true }),
    ];

    expect(visibleBoardStatuses(statuses, [], "all")).toEqual(statuses);
  });

  it("keeps manual order and applies the two automatic sorts", () => {
    const tasks = [
      task("0198f0a0-0000-7000-8000-000000000001", {
        rank: "b0",
        priority: "low",
        dueDate: null,
      }),
      task("0198f0a0-0000-7000-8000-000000000002", {
        rank: "a0",
        priority: "urgent",
        dueDate: "2026-09-02",
      }),
      task("0198f0a0-0000-7000-8000-000000000003", {
        rank: "c0",
        priority: "medium",
        dueDate: "2026-09-01",
      }),
    ];

    expect(sortBoardTasks(tasks, "manual").map((item) => item.id.at(-1))).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(sortBoardTasks(tasks, "priority").map((item) => item.id.at(-1))).toEqual([
      "2",
      "3",
      "1",
    ]);
    expect(sortBoardTasks(tasks, "due").map((item) => item.id.at(-1))).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("describes a cross-lane insertion using lower and higher neighbours", () => {
    const tasks = [
      task("0198f0a0-0000-7000-8000-000000000001"),
      task("0198f0a0-0000-7000-8000-000000000002", { statusId: DONE }),
      task("0198f0a0-0000-7000-8000-000000000003", { statusId: DONE }),
    ];

    expect(placementForDrop(tasks, tasks[0]!.id, DONE, tasks[2]!.id, false)).toEqual({
      statusId: DONE,
      beforeTaskId: tasks[1]!.id,
      afterTaskId: tasks[2]!.id,
    });
  });

  it("recognises a drop that leaves a task between the same neighbours", () => {
    const tasks = [
      task("0198f0a0-0000-7000-8000-000000000001"),
      task("0198f0a0-0000-7000-8000-000000000002"),
      task("0198f0a0-0000-7000-8000-000000000003"),
    ];
    const placement = placementForDrop(tasks, tasks[1]!.id, READY, tasks[0]!.id, true);

    expect(placementChangesTask(tasks, tasks[1]!, placement)).toBe(false);
  });

  it("moves one canonical task and mirrors Done completion optimistically", () => {
    const source = task("0198f0a0-0000-7000-8000-000000000001");
    const response: ProjectBoardResponse = {
      data: {
        project: {
          id: BASE_TASK.projectId!,
          workspaceId: BASE_TASK.workspaceId,
          name: "Research",
          slug: "research",
          descriptionMd: null,
          colorToken: "blue",
          icon: null,
          archivedAt: null,
          version: 1,
          createdAt: BASE_TASK.createdAt,
          updatedAt: BASE_TASK.updatedAt,
        },
        statuses: [
          status(READY),
          status(DONE, { name: "Done", category: "done", isTerminal: true }),
        ],
        tasks: [source],
      },
      page: { hasMore: false, truncated: false },
    };

    const moved = moveTaskInBoard(response, {
      taskId: source.id,
      placement: { statusId: DONE, beforeTaskId: null, afterTaskId: null },
      destination: response.data.statuses[1]!,
      now: "2026-08-30T13:00:00.000Z",
    });

    expect(tasksInStatus(moved.data.tasks, READY, "manual")).toHaveLength(0);
    expect(tasksInStatus(moved.data.tasks, DONE, "manual")[0]).toMatchObject({
      id: source.id,
      isCompleted: true,
      completedAt: "2026-08-30T13:00:00.000Z",
    });
    expect(moved.data.tasks).toHaveLength(1);
  });
});
