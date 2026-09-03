"use client";

import type {
  CreateTaskRequest,
  ListTasksQuery,
  ProjectBoardResponse,
  TaskDto,
  TaskListResponse,
  UpdateTaskRequest,
} from "@morrowlist/contracts";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { activityKeys } from "../../activity/hooks/use-activity";
import { projectKeys } from "../../projects/hooks/use-projects";
import { patchTaskInBoard, selectInboxDestination } from "../lib/task-projections";
import { matchesFilters } from "../lib/task-view";

import { apiClient } from "@/lib/api-client";

/**
 * Task server state (spec 23.2, 23.3).
 *
 * Query keys are structured so one mutation can update every projection that shows a
 * task, without a component needing to know which other views exist. The filters travel
 * inside the key, which is what lets the shared patch below decide whether a changed task
 * still belongs in a given list instead of every view re-implementing that rule.
 */

export const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters: Partial<ListTasksQuery>) =>
    [...taskKeys.lists(), filters] as const satisfies QueryKey,
  detail: (idOrKey: string) => [...taskKeys.all, "detail", idOrKey] as const,
};

type ListSnapshot = readonly [QueryKey, TaskListResponse | undefined][];
type BoardSnapshot = readonly [QueryKey, ProjectBoardResponse | undefined][];

interface TaskProjectionSnapshot {
  readonly lists: ListSnapshot;
  readonly boards: BoardSnapshot;
  readonly byId: TaskDto | undefined;
  readonly byKey: TaskDto | undefined;
}

function filtersOf(key: QueryKey): Partial<ListTasksQuery> {
  return (key[2] ?? {}) as Partial<ListTasksQuery>;
}

/**
 * The one canonical optimistic patch (spec 23.3, "do not duplicate patch logic per
 * view"). A task is replaced wherever it is cached, and drops out of the lists whose
 * filters it no longer satisfies.
 */
function patchTaskEverywhere(queryClient: QueryClient, task: TaskDto): void {
  for (const [key, current] of snapshotLists(queryClient)) {
    if (!current?.data.some((candidate) => candidate.id === task.id)) continue;
    const filters = filtersOf(key);
    queryClient.setQueryData<TaskListResponse>(key, {
      ...current,
      data: current.data.flatMap((candidate) =>
        candidate.id !== task.id
          ? [candidate]
          : matchesFilters(task, filters)
            ? [task]
            : [],
      ),
    });
  }

  for (const [key, current] of snapshotBoards(queryClient)) {
    if (current) {
      queryClient.setQueryData<ProjectBoardResponse>(
        key,
        patchTaskInBoard(current, task),
      );
    }
  }

  patchDetail(queryClient, task.id, task);
  patchDetail(queryClient, task.key, task);
}

/** Only refresh a detail entry that is actually cached; never conjure one. */
function patchDetail(
  queryClient: QueryClient,
  idOrKey: string,
  task: TaskDto | undefined,
): void {
  const key = taskKeys.detail(idOrKey);
  if (queryClient.getQueryState(key)) queryClient.setQueryData(key, task);
}

function snapshotLists(queryClient: QueryClient): ListSnapshot {
  return queryClient.getQueriesData<TaskListResponse>({ queryKey: taskKeys.lists() });
}

function snapshotBoards(queryClient: QueryClient): BoardSnapshot {
  return queryClient.getQueriesData<ProjectBoardResponse>({
    queryKey: projectKeys.boards(),
  });
}

function snapshotTaskProjections(
  queryClient: QueryClient,
  task: TaskDto,
): TaskProjectionSnapshot {
  return {
    lists: snapshotLists(queryClient),
    boards: snapshotBoards(queryClient),
    byId: queryClient.getQueryData<TaskDto>(taskKeys.detail(task.id)),
    byKey: queryClient.getQueryData<TaskDto>(taskKeys.detail(task.key)),
  };
}

function restoreLists(queryClient: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, value] of snapshot) queryClient.setQueryData(key, value);
}

function restoreBoards(queryClient: QueryClient, snapshot: BoardSnapshot): void {
  for (const [key, value] of snapshot) queryClient.setQueryData(key, value);
}

function restoreTaskProjections(
  queryClient: QueryClient,
  task: TaskDto,
  snapshot: TaskProjectionSnapshot,
): void {
  restoreLists(queryClient, snapshot.lists);
  restoreBoards(queryClient, snapshot.boards);
  patchDetail(queryClient, task.id, snapshot.byId);
  patchDetail(queryClient, task.key, snapshot.byKey);
}

function invalidateLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
}

function invalidateTaskProjections(queryClient: QueryClient): void {
  invalidateLists(queryClient);
  void queryClient.invalidateQueries({ queryKey: projectKeys.boards() });
  // Every mutation records history, so any open activity list is now behind.
  void queryClient.invalidateQueries({ queryKey: activityKeys.all });
}

async function cancelTaskProjections(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: taskKeys.all }),
    queryClient.cancelQueries({ queryKey: projectKeys.boards() }),
  ]);
}

export function useTaskList(filters: Partial<ListTasksQuery>) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () => apiClient.listTasks(filters),
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
      patchTaskEverywhere(queryClient, created);
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

  return useMutation({
    mutationFn: async ({ task, projectId }: MoveTaskToProjectInput) => {
      if (projectId === null) {
        return apiClient.moveTask(task.id, {
          projectId: null,
          expectedVersion: task.version,
        });
      }

      const detail = await queryClient.fetchQuery({
        queryKey: projectKeys.detail(projectId),
        queryFn: () => apiClient.getProject(projectId),
      });
      const destination = selectInboxDestination(detail.statuses);
      if (!destination) {
        throw new Error("This project has no active workflow status.");
      }

      return apiClient.moveTask(task.id, {
        projectId,
        statusId: destination.id,
        expectedVersion: task.version,
      });
    },
    onSuccess: (moved) => patchTaskEverywhere(queryClient, moved),
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
      const previous = snapshotTaskProjections(queryClient, task);
      patchTaskEverywhere(queryClient, { ...task, ...stripControlFields(patch) });
      return { previous, task };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      restoreTaskProjections(queryClient, context.task, context.previous);
    },
    onSuccess: (updated) => patchTaskEverywhere(queryClient, updated),
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

/** `expectedVersion` is a concurrency control, not a task field; it never enters the cache. */
function stripControlFields(patch: UpdateTaskRequest): Partial<TaskDto> {
  const { expectedVersion: _expectedVersion, ...fields } = patch;
  return fields as Partial<TaskDto>;
}

export function useCompleteTask() {
  return useTaskAction(
    (task) => apiClient.completeTask(task.id, task.version),
    (task) => ({
      ...task,
      isCompleted: true,
      completedAt: new Date().toISOString(),
    }),
  );
}

export function useReopenTask() {
  return useTaskAction(
    (task) => apiClient.reopenTask(task.id, task.version),
    (task) => ({
      ...task,
      isCompleted: false,
      completedAt: null,
    }),
  );
}

export function useDeleteTask() {
  return useTaskAction(
    (task) => apiClient.deleteTask(task.id),
    (task) => ({
      ...task,
      deletedAt: new Date().toISOString(),
    }),
  );
}

export function useRestoreTask() {
  return useTaskAction(
    (task) => apiClient.restoreTask(task.id),
    (task) => ({
      ...task,
      deletedAt: null,
    }),
  );
}

/**
 * Complete, reopen, delete, and restore differ only in the request they send and the
 * shape of their optimistic guess; everything about snapshotting, patching, rollback, and
 * invalidation is identical, so it lives here once.
 */
function useTaskAction(
  send: (task: TaskDto) => Promise<TaskDto>,
  guess: (task: TaskDto) => TaskDto,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (task: TaskDto) => {
      await cancelTaskProjections(queryClient);
      const previous = snapshotTaskProjections(queryClient, task);
      patchTaskEverywhere(queryClient, guess(task));
      return { previous, task };
    },
    onError: (_error, _task, context) => {
      if (context) {
        restoreTaskProjections(queryClient, context.task, context.previous);
      }
    },
    onSuccess: (task) => patchTaskEverywhere(queryClient, task),
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}
