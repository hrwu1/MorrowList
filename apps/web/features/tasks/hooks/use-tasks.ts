"use client";

import type {
  CreateTaskRequest,
  ListTasksQuery,
  ReorderTaskRequest,
  TaskDto,
  TaskCommandResult,
  UpdateTaskRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { projectKeys } from "../../projects/lib/project-keys";
import {
  cachedTasks,
  patchTaskEverywhere,
  invalidateTaskProjections,
  cancelTaskProjections,
  snapshotTaskProjections,
  restoreTaskProjections,
  workspaceToday,
} from "../lib/task-cache";
import { taskFromResult, type TaskMutationResult } from "../lib/task-command-result";
import { taskKeys } from "../lib/task-keys";
import { selectInboxDestination } from "../lib/task-projections";
import { neighboursOf, undoLabel, type UndoOffer } from "../lib/undo";

import { useTaskFeedback } from "./use-task-feedback";
import { useUndo } from "./use-undo";

import { apiClient } from "@/lib/api-client";
export {
  cachedTasks,
  patchTaskEverywhere,
  invalidateTaskProjections,
} from "../lib/task-cache";

/**
 * Task server state (spec 23.2, 23.3).
 *
 * Query keys are structured so one mutation can update every projection that shows a
 * task, without a component needing to know which other views exist. The filters travel
 * inside the key, which is what lets the shared patch below decide whether a changed task
 * still belongs in a given list instead of every view re-implementing that rule.
 */

export { taskKeys } from "../lib/task-keys";

export function useTaskList(
  filters: Partial<ListTasksQuery>,
  options: { readonly enabled?: boolean | undefined } = {},
) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => apiClient.listTasks(filters),
    enabled: options.enabled ?? true,
  });
}

/** One task by UUID or workspace key, for the detail panel and the detail route. */
export function useTask(idOrKey: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(idOrKey ?? ""),
    queryFn: () => apiClient.getTask(idOrKey ?? ""),
    enabled: idOrKey !== null,
    // A soft-deleted task 404s on read, so a background refetch after the delete in the
    // panel would replace a usable "moved to Trash" state with an error.
    refetchOnWindowFocus: false,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateTaskRequest) => apiClient.createTask(request),
    onSuccess: (created) => {
      patchTaskEverywhere(queryClient, created, { previous: null });
      invalidateTaskProjections(queryClient);
    },
  });
}

export interface MoveTaskToProjectInput {
  readonly task: TaskDto;
  /** Null returns the task to the Inbox (spec 11.5). */
  readonly projectId: string | null;
}

/**
 * Send a task to another project's active default lane, or back to the Inbox, in one
 * atomic move. This is the Inbox tray's "send to project", the detail's Project field,
 * and the sidebar drop target, so every path lands the task in the same place.
 */
export function useMoveTaskToProject() {
  const queryClient = useQueryClient();
  const { offer } = useUndo();
  const { report } = useTaskFeedback();

  return useMutation({
    mutationFn: async ({ task, projectId }: MoveTaskToProjectInput) => {
      if (projectId === null) {
        const result = await apiClient.moveTask(task.id, {
          projectId: null,
          expectedVersion: task.version,
        });
        return result;
      }

      const detail = await queryClient.fetchQuery({
        queryKey: projectKeys.detail(projectId),
        queryFn: () => apiClient.getProject(projectId),
      });
      const destination = selectInboxDestination(detail.statuses);
      if (!destination) {
        throw new Error("This project has no active workflow status.");
      }

      const result = await apiClient.moveTask(task.id, {
        projectId,
        statusId: destination.id,
        expectedVersion: task.version,
      });
      return result;
    },
    onSuccess: (result, { task }) => {
      const moved = result.task;
      const neighbours = neighboursOf(task, cachedTasks(queryClient));
      patchTaskEverywhere(queryClient, moved, { previous: task });
      report(result);
      offer({
        id: moved.id,
        label: undoLabel("Moved", moved),
        compensate: async () => {
          return apiClient.moveTask(moved.id, {
            projectId: task.projectId,
            ...(task.statusId ? { statusId: task.statusId } : {}),
            ...neighbours,
            expectedVersion: moved.version,
          });
        },
      });
    },
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

export interface MoveTaskToReadyInput {
  readonly taskId: string;
  readonly projectId: string;
}

/**
 * Put a started task back into its project's Ready column, from the in-progress limit
 * warning (GAP-20). Falls back to the project's default column when no Ready-category
 * column exists.
 */
export function useMoveTaskToReady() {
  const queryClient = useQueryClient();
  const { report } = useTaskFeedback();
  return useMutation({
    mutationFn: async ({ taskId, projectId }: MoveTaskToReadyInput) => {
      const [task, detail] = await Promise.all([
        apiClient.getTask(taskId),
        queryClient.fetchQuery({
          queryKey: projectKeys.detail(projectId),
          queryFn: () => apiClient.getProject(projectId),
        }),
      ]);
      const ready =
        detail.statuses.find(
          (status) => status.category === "ready" && status.archivedAt === null,
        ) ?? selectInboxDestination(detail.statuses);
      if (!ready) throw new Error("This project has no Ready column.");
      const result = await apiClient.moveTask(taskId, {
        projectId,
        statusId: ready.id,
        expectedVersion: task.version,
      });
      return result;
    },
    onSuccess: (result) => {
      patchTaskEverywhere(queryClient, result.task);
      report(result);
    },
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

/**
 * Field edits from the detail panel and the row menus. Applied optimistically so a
 * priority change lands immediately, and rolled back as a whole on failure (spec 23.3).
 * `expectedVersion` is the caller's, so a concurrent edit is reported rather than
 * overwritten.
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, patch }: { task: TaskDto; patch: UpdateTaskRequest }) =>
      apiClient.updateTask(task.id, { expectedVersion: task.version, ...patch }),
    onMutate: async ({ task, patch }) => {
      await cancelTaskProjections(queryClient);
      const previous = snapshotTaskProjections(queryClient);
      const optimistic: TaskDto = {
        ...task,
        ...stripControlFields(patch),
        // The field patch is a per-key delta, not a replacement (GAP-24).
        ...(patch.fields
          ? { fields: mergeFieldValues(task.fields, patch.fields) }
          : {}),
      };
      patchTaskEverywhere(queryClient, optimistic);
      return { previous, optimistic };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskProjections(queryClient, context.previous);
    },
    onSuccess: (updated, _variables, context) =>
      patchTaskEverywhere(queryClient, updated, { previous: context?.optimistic }),
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

/** `expectedVersion` is a concurrency control, not a task field; it never enters the cache. */
function stripControlFields(patch: UpdateTaskRequest): Partial<TaskDto> {
  const { expectedVersion: _expectedVersion, ...fields } = patch;
  return fields as Partial<TaskDto>;
}

/**
 * Apply a typed custom-field patch to the cached values (GAP-24): an omitted key is
 * untouched, an explicit null removes it. The same rule the domain applies on the server.
 */
function mergeFieldValues(
  current: TaskDto["fields"],
  patch: NonNullable<UpdateTaskRequest["fields"]>,
): TaskDto["fields"] {
  const next: Record<string, string | number> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/**
 * Every caller warns before completing a blocked task (spec 8.4), so the acknowledgement
 * travels with the request; the server still refuses if a stale cache hid the block.
 */
export function useCompleteTask() {
  return useTaskAction(
    (task) =>
      apiClient.completeTask(task.id, {
        expectedVersion: task.version,
        ...(task.isBlocked ? { acknowledgeBlocked: true } : {}),
      }),
    (task) => ({
      ...task,
      isCompleted: true,
      completedAt: new Date().toISOString(),
    }),
    [],
    (done) => ({
      id: done.id,
      label: undoLabel("Completed", done),
      compensate: () => apiClient.reopenTask(done.id, done.version),
    }),
  );
}

export function useReopenTask() {
  return useTaskAction<TaskDto, TaskCommandResult>(
    (task) => apiClient.reopenTask(task.id, task.version),
    (task) => ({
      ...task,
      isCompleted: false,
      completedAt: null,
    }),
    [],
    (open) => ({
      id: open.id,
      label: undoLabel("Reopened", open),
      compensate: () =>
        apiClient.completeTask(open.id, {
          expectedVersion: open.version,
          ...(open.isBlocked ? { acknowledgeBlocked: true } : {}),
        }),
    }),
  );
}

export function useDeleteTask() {
  return useTaskAction(
    (task) => apiClient.deleteTask(task.id, task.version),
    (task) => ({
      ...task,
      deletedAt: new Date().toISOString(),
    }),
    [],
    (trashed) => ({
      id: trashed.id,
      label: undoLabel("Moved to Trash:", trashed),
      compensate: () => apiClient.restoreTask(trashed.id, trashed.version),
    }),
  );
}

export function useRestoreTask() {
  return useTaskAction(
    (task) => apiClient.restoreTask(task.id, task.version),
    (task) => ({
      ...task,
      deletedAt: null,
    }),
  );
}

/** Add a task to My Day for the workspace's current date (spec 9.2, 23.3). */
export function useAddToDay() {
  return useTaskAction(
    (task) => apiClient.addTaskToDay(task.id),
    (task, today) => ({
      ...task,
      dayPlans: task.dayPlans.includes(today)
        ? task.dayPlans
        : [...task.dayPlans, today].sort(),
    }),
    [],
    (planned) => {
      // A My Day selection is a dated relation, not a task column, so it carries no
      // version: removing a date that is already gone is a harmless no-op.
      const date = planned.dayPlans[0];
      return date
        ? {
            id: `${planned.id}:day`,
            label: undoLabel("Added to My Day:", planned),
            compensate: () => apiClient.removeTaskFromDay(planned.id, date),
          }
        : null;
    },
  );
}

/** Remove today's My Day selection: the first upcoming plan on the task. */
export function useRemoveFromDay() {
  return useTaskAction(
    (task) => {
      const date = task.dayPlans[0];
      return date ? apiClient.removeTaskFromDay(task.id, date) : Promise.resolve(task);
    },
    (task) => ({ ...task, dayPlans: task.dayPlans.slice(1) }),
    [],
    (cleared, task) => {
      const date = task.dayPlans[0];
      return date
        ? {
            id: `${cleared.id}:day`,
            label: undoLabel("Removed from My Day:", cleared),
            compensate: () => apiClient.addTaskToDay(cleared.id, { date }),
          }
        : null;
    },
  );
}

/**
 * Skip the current occurrence of a repeating task (GAP-12). The next date is the server's
 * to compute, so the optimistic guess leaves the task as it is; the response replaces it.
 */
export function useSkipOccurrence() {
  return useTaskAction(
    (task) => apiClient.skipOccurrence(task.id, task.version),
    (task) => task,
  );
}

export interface SetTaskParentInput {
  readonly task: TaskDto;
  readonly parentTaskId: string;
}

/** Make a task a subtask of another (spec 8.3). The server enforces depth and cycles. */
export function useSetTaskParent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, parentTaskId }: SetTaskParentInput) =>
      apiClient.setTaskParent(task.id, { parentTaskId, expectedVersion: task.version }),
    onSuccess: (updated) => patchTaskEverywhere(queryClient, updated),
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

export function useClearTaskParent() {
  return useTaskAction(
    (task) => apiClient.clearTaskParent(task.id, task.version),
    (task) => ({ ...task, parentTaskId: null }),
  );
}

export interface ReorderTaskInput {
  readonly task: TaskDto;
  readonly beforeTaskId: string | null;
  readonly afterTaskId: string | null;
}

/** Rank-only move between two neighbours in the task's own status (spec 24.2). */
export function useReorderTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, beforeTaskId, afterTaskId }: ReorderTaskInput) =>
      apiClient.reorderTask(task.id, {
        beforeTaskId,
        afterTaskId,
        expectedVersion: task.version,
      } satisfies ReorderTaskRequest),
    onSuccess: (updated) => patchTaskEverywhere(queryClient, updated),
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

/**
 * Complete, reopen, delete, restore, and tag changes differ only in the request they
 * send and the shape of their optimistic guess; everything about snapshotting, patching,
 * rollback, and invalidation is identical, so it lives here once. `alsoInvalidate`
 * lists any other cache the action affects.
 *
 * `undoOf` turns the action's result into the offer the toast shows (spec 10.3). It lives
 * here rather than at each call site so completing a task from a row, a board card, or
 * the detail panel all leave the same eight-second offer, and so an action that has no
 * sensible inverse simply omits it.
 */
export function useTaskAction<V = TaskDto, R extends TaskMutationResult = TaskDto>(
  send: (variables: V) => Promise<R>,
  guess: (variables: V, today: string) => TaskDto,
  alsoInvalidate: readonly QueryKey[] = [],
  undoOf?: (result: TaskDto, variables: V) => UndoOffer | null,
) {
  const queryClient = useQueryClient();
  const { offer } = useUndo();
  const { report } = useTaskFeedback();
  return useMutation({
    mutationFn: send,
    onMutate: async (variables: V) => {
      await cancelTaskProjections(queryClient);
      const previous = snapshotTaskProjections(queryClient);
      const optimistic = guess(variables, workspaceToday(queryClient));
      patchTaskEverywhere(queryClient, optimistic);
      return { previous, optimistic };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskProjections(queryClient, context.previous);
    },
    onSuccess: (result, variables, context) => {
      const task = taskFromResult(result);
      report(result);
      patchTaskEverywhere(queryClient, task, { previous: context?.optimistic });
      const undo = undoOf?.(task, variables);
      if (undo) offer(undo);
    },
    onSettled: () => {
      invalidateTaskProjections(queryClient);
      for (const key of alsoInvalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
