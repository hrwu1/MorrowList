import type {
  BoardColumnDto,
  BoardLaneDto,
  BoardPlacementDto,
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  boardDropIntent,
  moveTaskInBoard,
  placementChangesTask,
  placementForDrop,
  readBoardStageView,
  readBoardSort,
  readBoardSubtasks,
  sortBoardTasks,
  readBoardSwimlane,
  tasksInCell,
  tasksInColumn,
  tasksInStatus,
  visibleBoardStatuses,
  type BoardDrop,
  type BoardDropInput,
  type BoardPlacement,
} from "./board-view";

const BASE_TASK: TaskDto = {
  id: "0198f0a0-0000-7000-8000-000000000001",
  key: "ML-000001",
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
  deferUntil: null,
  deadline: null,
  deadlineTime: null,
  dateWarnings: [],
  reminderOffsetMinutes: null,
  parentTaskId: null,
  recurrence: null,
  seriesId: null,
  fields: {},
  rank: "a0",
  isCompleted: false,
  completedAt: null,
  version: 1,
  tags: [],
  createdBy: { kind: "user", id: "user-1" },
  lastActor: { kind: "user", id: "user-1" },
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  deletedAt: null,
  dayPlans: [],
  subtaskProgress: null,
  relations: [],
  blocked: null,
  isBlocked: false,
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
  policyMd: null,
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
        swimlaneBy: "none",
        lanes: [
          {
            key: "all",
            label: "All cards",
            value: null,
            writable: false,
            colorToken: null,
            count: 1,
          },
        ],
        placements: [
          { taskId: source.id, columnKey: `status:${READY}`, laneKey: "all" },
        ],
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

describe("readBoardSubtasks", () => {
  it("hides subtasks unless the URL asks to show them", () => {
    expect(readBoardSubtasks(new URLSearchParams(""))).toBe(false);
    expect(readBoardSubtasks(new URLSearchParams("subtasks=show"))).toBe(true);
    expect(readBoardSubtasks(new URLSearchParams("subtasks=yes"))).toBe(false);
  });
});

describe("swimlanes (GAP-19)", () => {
  const lane = (key: string, overrides: Partial<BoardLaneDto> = {}): BoardLaneDto => ({
    key,
    label: key,
    value: key.split(":")[1] ?? null,
    writable: true,
    colorToken: null,
    count: 0,
    ...overrides,
  });
  const column = (
    key: string,
    overrides: Partial<BoardColumnDto> = {},
  ): BoardColumnDto => ({
    key,
    label: key,
    category: "ready",
    statusId: null,
    isTerminal: false,
    wipLimit: null,
    colorToken: "blue",
    ...overrides,
  });
  const NOWHERE: BoardPlacement = {
    statusId: DONE,
    beforeTaskId: null,
    afterTaskId: null,
  };

  function drop(overrides: Partial<BoardDropInput>): BoardDrop {
    return boardDropIntent({
      task: task("0198f0a0-0000-7000-8000-000000000001"),
      swimlaneBy: "priority",
      from: { laneKey: "priority:none", columnKey: `status:${READY}` },
      to: {
        type: "cell",
        laneKey: "priority:none",
        columnKey: `status:${READY}`,
        statusId: READY,
      },
      lanes: [lane("priority:none"), lane("priority:urgent")],
      columns: [
        column(`status:${READY}`, { statusId: READY }),
        column(`status:${DONE}`, {
          statusId: DONE,
          category: "done",
          isTerminal: true,
        }),
      ],
      placement: NOWHERE,
      reorderDisabled: false,
      ...overrides,
    });
  }

  it("reads the swimlane from the URL and ignores anything unknown", () => {
    expect(readBoardSwimlane(new URLSearchParams())).toBe("none");
    expect(readBoardSwimlane(new URLSearchParams("swimlane=priority"))).toBe(
      "priority",
    );
    expect(readBoardSwimlane(new URLSearchParams("swimlane=colour"))).toBe("none");
  });

  it("groups cards into cells by lane and column without regrouping them itself", () => {
    const tasks = [
      task("0198f0a0-0000-7000-8000-000000000001"),
      task("0198f0a0-0000-7000-8000-000000000002"),
    ];
    const placements: BoardPlacementDto[] = [
      {
        taskId: tasks[0]!.id,
        columnKey: `status:${READY}`,
        laneKey: "priority:urgent",
      },
      { taskId: tasks[1]!.id, columnKey: `status:${READY}`, laneKey: "priority:none" },
    ];

    expect(
      tasksInCell(
        tasks,
        placements,
        "priority:urgent",
        `status:${READY}`,
        "manual",
      ).map((item) => item.id),
    ).toEqual([tasks[0]!.id]);
    expect(tasksInColumn(tasks, placements, `status:${READY}`)).toHaveLength(2);
  });

  it("reorders inside one cell and moves when the column changes", () => {
    expect(drop({}).steps).toEqual([{ kind: "reorder", placement: NOWHERE }]);
    expect(
      drop({
        to: {
          type: "cell",
          laneKey: "priority:none",
          columnKey: `status:${DONE}`,
          statusId: DONE,
        },
      }).steps,
    ).toEqual([
      {
        kind: "move",
        projectId: task("x").projectId,
        statusId: DONE,
        statusCategory: null,
        placement: NOWHERE,
      },
    ]);
  });

  it("writes the lane attribute when a card crosses a writable lane", () => {
    expect(
      drop({
        to: {
          type: "cell",
          laneKey: "priority:urgent",
          columnKey: `status:${READY}`,
          statusId: READY,
        },
      }).steps,
    ).toEqual([{ kind: "priority", priority: "urgent" }]);
  });

  it("changes both the column and the lane on a diagonal drop", () => {
    const steps = drop({
      to: {
        type: "cell",
        laneKey: "priority:urgent",
        columnKey: `status:${DONE}`,
        statusId: DONE,
      },
    }).steps;

    expect(steps.map((step) => step.kind)).toEqual(["move", "priority"]);
  });

  it("swaps the tag when a card crosses a tag lane", () => {
    const steps = drop({
      swimlaneBy: "tag",
      from: { laneKey: "tag:tag-a", columnKey: `status:${READY}` },
      to: {
        type: "cell",
        laneKey: "tag:tag-b",
        columnKey: `status:${READY}`,
        statusId: READY,
      },
      lanes: [
        lane("tag:tag-a", { value: "tag-a" }),
        lane("tag:tag-b", { value: "tag-b" }),
      ],
    }).steps;

    expect(steps).toEqual([{ kind: "tag", addTagId: "tag-b", removeTagId: "tag-a" }]);
  });

  it("refuses a drop into a read-only lane and says why", () => {
    const refused = drop({
      swimlaneBy: "due",
      from: { laneKey: "due:none", columnKey: `status:${READY}` },
      to: {
        type: "cell",
        laneKey: "due:today",
        columnKey: `status:${READY}`,
        statusId: READY,
      },
      lanes: [
        lane("due:none", { writable: false }),
        lane("due:today", { writable: false }),
      ],
    });

    expect(refused.steps).toEqual([]);
    expect(refused.refusal).toContain("read-only");
  });

  it("completes an Inbox card dropped in Done and refuses any other column", () => {
    const inbox = task("0198f0a0-0000-7000-8000-000000000009", {
      projectId: null,
      statusId: null,
    });
    const columns = [
      column("category:ready", { category: "ready" }),
      column("category:done", { category: "done", isTerminal: true }),
    ];

    expect(
      drop({
        task: inbox,
        from: { laneKey: "priority:none", columnKey: "category:ready" },
        to: {
          type: "cell",
          laneKey: "priority:none",
          columnKey: "category:done",
          statusId: null,
        },
        columns,
      }).steps,
    ).toEqual([{ kind: "complete" }]);

    const refused = drop({
      task: inbox,
      from: { laneKey: "priority:none", columnKey: "category:backlog" },
      to: {
        type: "cell",
        laneKey: "priority:none",
        columnKey: "category:ready",
        statusId: null,
      },
      columns: [column("category:backlog", { category: "backlog" }), ...columns],
    });
    expect(refused.steps).toEqual([]);
    expect(refused.refusal).toContain("Inbox");
  });

  it("names a category destination when the column spans projects", () => {
    const steps = drop({
      from: { laneKey: "priority:none", columnKey: "category:ready" },
      to: {
        type: "cell",
        laneKey: "priority:none",
        columnKey: "category:in_progress",
        statusId: null,
      },
      columns: [
        column("category:ready"),
        column("category:in_progress", { category: "in_progress" }),
      ],
    }).steps;

    expect(steps).toEqual([
      {
        kind: "move",
        projectId: BASE_TASK.projectId,
        statusId: null,
        statusCategory: "in_progress",
        placement: NOWHERE,
      },
    ]);
  });

  it("carries a card to another project's lane in that project's own workflow", () => {
    const steps = drop({
      swimlaneBy: "project",
      from: { laneKey: "project:p1", columnKey: "category:ready" },
      to: {
        type: "cell",
        laneKey: "project:p2",
        columnKey: "category:ready",
        statusId: null,
      },
      lanes: [lane("project:p1", { value: "p1" }), lane("project:p2", { value: "p2" })],
      columns: [column("category:ready")],
    }).steps;

    expect(steps).toEqual([
      {
        kind: "move",
        projectId: "p2",
        statusId: null,
        statusCategory: "ready",
        placement: NOWHERE,
      },
    ]);
  });
});
