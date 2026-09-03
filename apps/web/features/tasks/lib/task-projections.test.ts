import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  allSubtasksDone,
  applyProgressDelta,
  hasOpenSubtasks,
  parentProgressDeltas,
  patchTaskInBoard,
  selectInboxDestination,
} from "./task-projections";

const PROJECT_ID = "0198f0a0-0000-7000-8000-000000000020";
const STATUS_ID = "0198f0a0-0000-7000-8000-000000000030";

function status(overrides: Partial<WorkflowStatusDto> = {}): WorkflowStatusDto {
  return {
    id: STATUS_ID,
    projectId: PROJECT_ID,
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
  };
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "0198f0a0-0000-7000-8000-000000000001",
    key: "ML-1",
    workspaceId: "0198f0a0-0000-7000-8000-000000000010",
    taskNumber: 1,
    projectId: PROJECT_ID,
    statusId: STATUS_ID,
    title: "Shape the launch narrative",
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
    tags: [],
    createdBy: { kind: "user", id: "user-1" },
    lastActor: { kind: "user", id: "user-1" },
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    ...overrides,
  };
}

function board(
  tasks: TaskDto[] = [],
  overrides: Partial<ProjectBoardResponse["page"]> = {},
): ProjectBoardResponse {
  return {
    data: {
      project: {
        id: PROJECT_ID,
        workspaceId: "0198f0a0-0000-7000-8000-000000000010",
        name: "Launch",
        slug: "launch",
        descriptionMd: null,
        colorToken: "blue",
        icon: null,
        archivedAt: null,
        version: 1,
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z",
      },
      statuses: [status()],
      tasks,
    },
    page: { hasMore: false, truncated: false, ...overrides },
  };
}

describe("selectInboxDestination", () => {
  it("uses an active default and falls back to the first active status", () => {
    const archivedDefault = status({
      id: "0198f0a0-0000-7000-8000-000000000031",
      archivedAt: "2026-08-30T13:00:00.000Z",
    });
    const firstActive = status({ isDefault: false });
    const laterDefault = status({
      id: "0198f0a0-0000-7000-8000-000000000032",
    });

    expect(selectInboxDestination([archivedDefault, firstActive, laterDefault])).toBe(
      laterDefault,
    );
    expect(selectInboxDestination([archivedDefault, firstActive])).toBe(firstActive);
  });

  it("returns no destination when every status is archived", () => {
    expect(
      selectInboxDestination([status({ archivedAt: "2026-08-30T13:00:00.000Z" })]),
    ).toBeUndefined();
  });
});

describe("patchTaskInBoard", () => {
  it("replaces a cached task and removes it when it leaves the projection", () => {
    const original = task();
    const updated = task({ title: "Polished narrative", version: 2 });

    const patched = patchTaskInBoard(board([original]), updated);
    expect(patched.data.tasks).toEqual([updated]);

    const removed = patchTaskInBoard(patched, {
      ...updated,
      deletedAt: "2026-08-30T13:00:00.000Z",
    });
    expect(removed.data.tasks).toEqual([]);
  });

  it("adds a newly assigned task only when the cached board is complete", () => {
    const assigned = task();

    expect(patchTaskInBoard(board(), assigned).data.tasks).toEqual([assigned]);
    expect(
      patchTaskInBoard(board([], { hasMore: true, truncated: true }), assigned).data
        .tasks,
    ).toEqual([]);
  });
});

describe("patchTaskInBoard with subtasks", () => {
  const PARENT_ID = "0198f0a0-0000-7000-8000-000000000099";

  it("keeps a new subtask off a board that hides subtasks, and adds it when shown", () => {
    const subtask = task({
      id: "0198f0a0-0000-7000-8000-000000000002",
      parentTaskId: PARENT_ID,
    });

    expect(patchTaskInBoard(board(), subtask).data.tasks).toEqual([]);
    expect(patchTaskInBoard(board(), subtask, true).data.tasks).toEqual([subtask]);
  });

  it("removes a task that just became a subtask from a hiding board", () => {
    const parent = task();
    const child = task({ id: "0198f0a0-0000-7000-8000-000000000002" });
    const attached = { ...child, parentTaskId: parent.id };

    expect(patchTaskInBoard(board([parent, child]), attached).data.tasks).toEqual([
      parent,
    ]);
  });
});

describe("parent progress projections", () => {
  const PARENT_ID = "0198f0a0-0000-7000-8000-000000000099";
  const OTHER_PARENT_ID = "0198f0a0-0000-7000-8000-000000000098";

  it("reads open and done states from the progress line", () => {
    expect(hasOpenSubtasks(task())).toBe(false);
    expect(hasOpenSubtasks(task({ subtaskProgress: { completed: 1, total: 2 } }))).toBe(
      true,
    );
    expect(allSubtasksDone(task({ subtaskProgress: { completed: 2, total: 2 } }))).toBe(
      true,
    );
    expect(allSubtasksDone(task())).toBe(false);
  });

  it("shifts completed when a child is ticked or reopened", () => {
    const open = task({ parentTaskId: PARENT_ID });
    const done = { ...open, isCompleted: true };

    expect([...parentProgressDeltas(open, done)]).toEqual([
      [PARENT_ID, { completed: 1, total: 0 }],
    ]);
    expect([...parentProgressDeltas(done, open)]).toEqual([
      [PARENT_ID, { completed: -1, total: 0 }],
    ]);
    expect(parentProgressDeltas(open, { ...open, title: "Renamed" }).size).toBe(0);
    expect(parentProgressDeltas(task(), { ...task(), isCompleted: true }).size).toBe(0);
  });

  it("shifts totals when a child is attached, moved, detached, or deleted", () => {
    const loose = task();
    const child = { ...loose, parentTaskId: PARENT_ID };

    expect([...parentProgressDeltas(undefined, child)]).toEqual([
      [PARENT_ID, { completed: 0, total: 1 }],
    ]);
    expect([...parentProgressDeltas(loose, child)]).toEqual([
      [PARENT_ID, { completed: 0, total: 1 }],
    ]);
    expect([...parentProgressDeltas(child, loose)]).toEqual([
      [PARENT_ID, { completed: 0, total: -1 }],
    ]);
    expect([
      ...parentProgressDeltas(
        { ...child, isCompleted: true },
        { ...child, isCompleted: true, parentTaskId: OTHER_PARENT_ID },
      ),
    ]).toEqual([
      [PARENT_ID, { completed: -1, total: -1 }],
      [OTHER_PARENT_ID, { completed: 1, total: 1 }],
    ]);
    expect([
      ...parentProgressDeltas(child, {
        ...child,
        deletedAt: "2026-08-30T12:00:00.000Z",
      }),
    ]).toEqual([[PARENT_ID, { completed: 0, total: -1 }]]);
  });

  it("applies a delta without going below zero or past the total", () => {
    const parent = task({ subtaskProgress: { completed: 1, total: 2 } });

    expect(
      applyProgressDelta(parent, { completed: 1, total: 0 }).subtaskProgress,
    ).toEqual({
      completed: 2,
      total: 2,
    });
    expect(
      applyProgressDelta(parent, { completed: -1, total: -1 }).subtaskProgress,
    ).toEqual({
      completed: 0,
      total: 1,
    });
    expect(
      applyProgressDelta(task(), { completed: 0, total: 1 }).subtaskProgress,
    ).toEqual({
      completed: 0,
      total: 1,
    });
    expect(
      applyProgressDelta(task({ subtaskProgress: { completed: 0, total: 1 } }), {
        completed: 0,
        total: -1,
      }).subtaskProgress,
    ).toBeNull();
  });
});
