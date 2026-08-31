import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { patchTaskInBoard, selectInboxDestination } from "./task-projections";

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
    createdBy: { kind: "user", id: "user-1" },
    lastActor: { kind: "user", id: "user-1" },
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:00:00.000Z",
    deletedAt: null,
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
