"use client";

import type {
  CreateTaskRequest,
  ListTasksQuery,
  ProjectBoardResponse,
  ReorderTaskRequest,
  TaskDto,
  TaskListResponse,
  TodayViewResponse,
  UpcomingViewResponse,
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
import { localToday, patchTaskInToday } from "../../today/lib/today-view";
import { patchTaskInUpcoming } from "../../upcoming/lib/upcoming-view";
import {
  applyProgressDelta,
  parentProgressDeltas,
  patchTaskInBoard,
  selectInboxDestination,
} from "../lib/task-projections";
import { matchesFilters } from "../lib/task-view";

import { todayKeys } from "@/features/today/hooks/use-today";
import { upcomingKeys } from "@/features/upcoming/hooks/use-upcoming";
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
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (idOrKey: string) => [...taskKeys.details(), idOrKey] as const,
};

type ListSnapshot = readonly [QueryKey, TaskListResponse | undefined][];
type Snapshot<T> = readonly [QueryKey, T | undefined][];

interface TaskProjectionSnapshot {
  readonly lists: ListSnapshot;
  readonly boards: Snapshot<ProjectBoardResponse>;
  readonly today: Snapshot<TodayViewResponse>;
  readonly upcoming: Snapshot<UpcomingViewResponse>;
  readonly details: Snapshot<TaskDto>;
}

function filtersOf(key: QueryKey): Partial<ListTasksQuery> {
  return (key[2] ?? {}) as Partial<ListTasksQuery>;
}

function boardIncludesSubtasks(key: QueryKey): boolean {
  return (
    (key[3] as { includeSubtasks?: boolean } | undefined)?.includeSubtasks ?? false
  );
}

/**
 * The one canonical optimistic patch (spec 23.3, "do not duplicate patch logic per
 * view"). A task is replaced wherever it is cached, and drops out of the lists whose
 * filters it no longer satisfies. Its parents' progress lines follow the change, so a
 * card reads "1/2" the moment a subtask is ticked rather than after the refetch.
 */
function patchTaskEverywhere(queryClient: QueryClient, task: TaskDto): void {
  const previous = findCachedTask(queryClient, task.id);
  replaceTaskInCaches(queryClient, task);

  for (const [parentId, delta] of parentProgressDeltas(previous, task)) {
    const parent = findCachedTask(queryClient, parentId);
    if (parent) replaceTaskInCaches(queryClient, applyProgressDelta(parent, delta));
  }
}

function findCachedTask(queryClient: QueryClient, taskId: string): TaskDto | undefined {
  for (const [, current] of snapshotDetails(queryClient)) {
    if (current?.id === taskId) return current;
  }
  for (const [, current] of snapshotLists(queryClient)) {
    const hit = current?.data.find((candidate) => candidate.id === taskId);
    if (hit) return hit;
  }
  for (const [, current] of snapshotBoards(queryClient)) {
    const hit = current?.data.tasks.find((candidate) => candidate.id === taskId);
    if (hit) return hit;
  }
  return undefined;
}

function replaceTaskInCaches(queryClient: QueryClient, task: TaskDto): void {
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
        patchTaskInBoard(current, task, boardIncludesSubtasks(key)),
      );
    }
  }

  for (const [key, current] of snapshotViews<TodayViewResponse>(
    queryClient,
    todayKeys.all,
  )) {
    if (current) queryClient.setQueryData(key, patchTaskInToday(current, task));
  }
  for (const [key, current] of snapshotViews<UpcomingViewResponse>(
    queryClient,
    upcomingKeys.all,
  )) {
    if (current) queryClient.setQueryData(key, patchTaskInUpcoming(current, task));
  }

  // Only refresh detail entries that are actually cached; never conjure one.
  for (const [key, current] of snapshotDetails(queryClient)) {
    if (current?.id === task.id) queryClient.setQueryData(key, task);
  }
}

function snapshotLists(queryClient: QueryClient): ListSnapshot {
  return queryClient.getQueriesData<TaskListResponse>({ queryKey: taskKeys.lists() });
}

function snapshotDetails(queryClient: QueryClient): Snapshot<TaskDto> {
  return queryClient.getQueriesData<TaskDto>({ queryKey: taskKeys.details() });
}

function snapshotBoards(queryClient: QueryClient): Snapshot<ProjectBoardResponse> {
  return queryClient.getQueriesData<ProjectBoardResponse>({
    queryKey: projectKeys.boards(),
  });
}

function snapshotViews<T>(queryClient: QueryClient, queryKey: QueryKey): Snapshot<T> {
  return queryClient.getQueriesData<T>({ queryKey });
}

function snapshotTaskProjections(queryClient: QueryClient): TaskProjectionSnapshot {
  return {
    lists: snapshotLists(queryClient),
    boards: snapshotBoards(queryClient),
    today: snapshotViews(queryClient, todayKeys.all),
    upcoming: snapshotViews(queryClient, upcomingKeys.all),
    details: snapshotDetails(queryClient),
  };
}

function restoreSnapshot<T>(queryClient: QueryClient, snapshot: Snapshot<T>): void {
  for (const [key, value] of snapshot) queryClient.setQueryData(key, value);
}

function restoreTaskProjections(
  queryClient: QueryClient,
  snapshot: TaskProjectionSnapshot,
): void {
  restoreSnapshot(queryClient, snapshot.lists);
  restoreSnapshot(queryClient, snapshot.boards);
  restoreSnapshot(queryClient, snapshot.today);
  restoreSnapshot(queryClient, snapshot.upcoming);
  restoreSnapshot(queryClient, snapshot.details);
}

function invalidateLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
}

/** Every projection that shows tasks: lists, boards, and the Today and Upcoming views. */
function invalidateTaskProjections(queryClient: QueryClient): void {
  invalidateLists(queryClient);
  void queryClient.invalidateQueries({ queryKey: projectKeys.boards() });
  // Every mutation records history, so any open activity list is now behind.
  void queryClient.invalidateQueries({ queryKey: activityKeys.all });
  void queryClient.invalidateQueries({ queryKey: todayKeys.all });
  void queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
}

async function cancelTaskProjections(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: taskKeys.all }),
    queryClient.cancelQueries({ queryKey: projectKeys.boards() }),
    queryClient.cancelQueries({ queryKey: todayKeys.all }),
    queryClient.cancelQueries({ queryKey: upcomingKeys.all }),
  ]);
}

/**
 * The workspace's current date as the browser last saw it in a Today response, falling
 * back to the browser's own date. Only an optimistic guess; the server's answer replaces
 * it on success (spec 12.3).
 */
function workspaceToday(queryClient: QueryClient): string {
  const cached = queryClient.getQueryData<TodayViewResponse>(todayKeys.view());
  return cached?.data.date ?? localToday();
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
      const previous = snapshotTaskProjections(queryClient);
      patchTaskEverywhere(queryClient, { ...task, ...stripControlFields(patch) });
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskProjections(queryClient, context.previous);
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
 */
export function useTaskAction<V = TaskDto>(
  send: (variables: V) => Promise<TaskDto>,
  guess: (variables: V, today: string) => TaskDto,
  alsoInvalidate: readonly QueryKey[] = [],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onMutate: async (variables: V) => {
      await cancelTaskProjections(queryClient);
      const previous = snapshotTaskProjections(queryClient);
      patchTaskEverywhere(queryClient, guess(variables, workspaceToday(queryClient)));
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskProjections(queryClient, context.previous);
    },
    onSuccess: (task) => patchTaskEverywhere(queryClient, task),
    onSettled: () => {
      invalidateTaskProjections(queryClient);
      for (const key of alsoInvalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
