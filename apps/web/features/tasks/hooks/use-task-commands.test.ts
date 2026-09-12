import type {
  TaskDto,
  TaskCommandResult,
  BatchTasksResult,
  WipWarningDto,
} from "@morrowlist/contracts";
import {
  QueryClient,
  type MutationObserver,
  type MutationObserverOptions,
} from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { useBoardDrop } from "../../board/hooks/use-board-view";
import type { UndoOffer } from "../lib/undo";

import { useBulkTasks } from "./use-bulk-tasks";
import {
  useCompleteTask,
  useDeleteTask,
  useMoveTaskToProject,
  useReopenTask,
} from "./use-tasks";

let client: QueryClient;
const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  offer: vi.fn(),
  reopenTask: vi.fn(),
  completeTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
  batchTasks: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ apiClient: mocks }));
vi.mock("./use-undo", () => ({ useUndo: () => ({ offer: mocks.offer }) }));
vi.mock("./use-task-feedback", () => ({
  useTaskFeedback: () => ({ report: mocks.report }),
}));
// Exercise the real React Query mutation lifecycle without a DOM renderer. Only React's
// hook binding is replaced; success/rollback/invalidation run through MutationObserver.
vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<{ MutationObserver: typeof MutationObserver }>();
  return {
    ...actual,
    useQueryClient: () => client,
    useMutation: (
      options: MutationObserverOptions<unknown, Error, unknown, unknown>,
    ) => {
      const observer = new actual.MutationObserver(client, options);
      return { mutateAsync: (variables: unknown) => observer.mutate(variables) };
    },
  };
});

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "01a04e0f-2e8a-7000-ae0a-989d784c0287",
    key: "ML-000001",
    workspaceId: "01a04e0f-2e8a-7000-ae0a-989d784c0288",
    taskNumber: 1,
    projectId: null,
    statusId: null,
    title: "Prepare research presentation",
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
    rank: "aa",
    isCompleted: false,
    completedAt: null,
    version: 1,
    tags: [],
    createdBy: { kind: "user", id: "u1" },
    lastActor: { kind: "user", id: "u1" },
    createdAt: "2026-08-29T09:00:00.000Z",
    updatedAt: "2026-08-29T09:00:00.000Z",
    deletedAt: null,
    dayPlans: [],
    subtaskProgress: null,
    relations: [],
    blocked: null,
    isBlocked: false,
    ...overrides,
  };
}

const warning: WipWarningDto = {
  code: "IN_PROGRESS_LIMIT_EXCEEDED",
  message: "2 tasks are in progress; the limit is 1.",
  count: 2,
  limit: 1,
  tasks: [],
};
function result(): TaskCommandResult {
  return { task: task({ version: 2 }), warnings: [warning] };
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(["tasks", "detail", "current"], task());
  client.setQueryData(["views", "today", "current"], {
    data: { date: "2026-09-12", sections: [], review: null },
  });
});
afterEach(() => client.clear());

describe("task command feedback parity", () => {
  it("sends the rendered version on delete and restores the task when deletion conflicts", async () => {
    const original = task();
    mocks.deleteTask.mockRejectedValue(new Error("Task changed"));
    await expect(useDeleteTask().mutateAsync(original)).rejects.toThrow("Task changed");
    expect(mocks.deleteTask).toHaveBeenCalledWith(original.id, original.version);
    expect(client.getQueryData(["tasks", "detail", "current"])).toEqual(original);
  });
  it("preserves reopening warnings for row, detail and shortcut callers", async () => {
    const response = result();
    mocks.reopenTask.mockResolvedValue(response);
    const current = task({ isCompleted: true });
    const returned = await useReopenTask().mutateAsync(current);
    expect(returned).toBe(response);
    expect(mocks.reopenTask).toHaveBeenCalledWith(current.id, current.version);
    expect(mocks.report).toHaveBeenCalledWith(response);
    expect(client.getQueryData(["tasks", "detail", "current"])).toEqual(response.task);
    expect(client.getQueryState(["views", "today", "current"])?.isInvalidated).toBe(
      true,
    );
  });

  it("preserves project assignment warnings and its undo result", async () => {
    const response = result();
    mocks.getProject.mockResolvedValue({
      statuses: [{ id: "status", isDefault: true, archivedAt: null }],
    });
    mocks.moveTask.mockResolvedValue(response);
    expect(
      await useMoveTaskToProject().mutateAsync({ task: task(), projectId: "project" }),
    ).toBe(response);
    expect(mocks.report).toHaveBeenCalledWith(response);
    const undo = mocks.offer.mock.calls[0]?.[0] as UndoOffer;
    expect(await undo.compensate()).toBe(response);
  });

  it("preserves warnings from cross-project board drops", async () => {
    const response = result();
    mocks.moveTask.mockResolvedValue(response);
    const returned = await useBoardDrop().mutateAsync({
      task: task(),
      steps: [
        {
          kind: "move",
          projectId: "project",
          statusId: null,
          statusCategory: "in_progress",
          placement: { statusId: "status", beforeTaskId: null, afterTaskId: null },
        },
      ],
    });
    expect(returned.warnings).toEqual([warning]);
    expect(mocks.report).toHaveBeenCalledWith(returned);
  });

  it("reports a bulk command's warnings and preserves the compensating batch envelope", async () => {
    const response: BatchTasksResult = {
      data: [{ op: "complete", taskId: task().id, data: task({ version: 2 }) }],
      warnings: [warning],
    };
    mocks.batchTasks.mockResolvedValue(response);
    expect(
      await useBulkTasks().mutateAsync({
        action: { kind: "complete" },
        tasks: [task()],
      }),
    ).toBe(response);
    expect(mocks.report).toHaveBeenCalledWith(response);
    const undo = mocks.offer.mock.calls[0]?.[0] as UndoOffer;
    expect(await undo.compensate()).toBe(response);
  });

  it("keeps reopening warnings when Undo compensates a completion", async () => {
    const response = result();
    mocks.completeTask.mockResolvedValue(task({ isCompleted: true, version: 2 }));
    mocks.reopenTask.mockResolvedValue(response);
    await useCompleteTask().mutateAsync(task());
    const undo = mocks.offer.mock.calls[0]?.[0] as UndoOffer;
    expect(await undo.compensate()).toBe(response);
  });
});
