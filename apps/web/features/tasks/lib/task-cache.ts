import type {
  BoardViewResponse,
  CalendarViewResponse,
  ListTasksQuery,
  ProjectBoardResponse,
  SearchResponse,
  TaskDto,
  TaskListResponse,
  TodayViewResponse,
  UpcomingViewResponse,
} from "@morrowlist/contracts";
import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";

import { activityKeys } from "../../activity/lib/activity-keys";
import { boardViewKeys } from "../../board/lib/board-keys";
import { calendarKeys, patchTaskInCalendar } from "../../calendar/lib/calendar-view";
import { flowKeys } from "../../flow/lib/flow-keys";
import { projectKeys, type BoardViewOptions } from "../../projects/lib/project-keys";
import { searchKeys } from "../../search/lib/search-keys";
import { todayKeys } from "../../today/lib/today-keys";
import { localToday, patchTaskInToday } from "../../today/lib/today-view";
import { upcomingKeys } from "../../upcoming/lib/upcoming-keys";
import { patchTaskInUpcoming } from "../../upcoming/lib/upcoming-view";
import { workspaceKeys } from "../../workspace/lib/workspace-keys";

import { taskKeys } from "./task-keys";
import {
  applyProgressDelta,
  parentProgressDeltas,
  patchTaskInBoard,
} from "./task-projections";
import { matchesFilters } from "./task-view";

interface TaskProjection {
  readonly key: QueryKey;
  readonly read: (value: unknown) => readonly TaskDto[];
  readonly patch?: (
    value: unknown,
    task: TaskDto,
    key: QueryKey,
    today: string,
  ) => unknown;
  readonly canRefetch: (value: unknown) => boolean;
}

function projection<T>(
  key: QueryKey,
  read: (value: T) => readonly TaskDto[],
  patch: (value: T, task: TaskDto, key: QueryKey, today: string) => T,
  canRefetch: (value: T) => boolean = () => true,
): TaskProjection {
  return {
    key,
    read: (value) => (value === undefined ? [] : read(value as T)),
    patch: (value, task, queryKey, today) =>
      value === undefined ? value : patch(value as T, task, queryKey, today),
    canRefetch: (value) => value === undefined || canRefetch(value as T),
  };
}

/**
 * One inventory for extraction, optimistic writes/rollback, cancellation, invalidation,
 * and background refresh. Metrics/history/counts are derived and are only refetched.
 * Grouped boards and search keep server-owned membership/placement until that refetch;
 * their existing task DTOs still receive field/version updates immediately.
 */
const taskProjections: readonly TaskProjection[] = [
  projection<TaskDto>(
    taskKeys.details(),
    (task) => [task],
    (current, task) => (current.id === task.id ? task : current),
    (task) => !task.deletedAt,
  ),
  projection<TaskListResponse>(
    taskKeys.lists(),
    (value) => value.data,
    (value, task, key) => ({
      ...value,
      data: value.data.flatMap((current) =>
        current.id !== task.id
          ? [current]
          : matchesFilters(task, (key[2] ?? {}) as Partial<ListTasksQuery>)
            ? [task]
            : [],
      ),
    }),
  ),
  projection<ProjectBoardResponse>(
    projectKeys.boards(),
    (value) => value.data.tasks,
    (value, task, key, today) =>
      patchTaskInBoard(value, task, {
        ...(key[3] as Partial<BoardViewOptions>),
        today,
      }),
  ),
  projection<TodayViewResponse>(
    todayKeys.all,
    (value) => [
      ...value.data.sections.flatMap((section) =>
        section.tasks.map((entry) => entry.task),
      ),
      ...(value.data.review?.tasks ?? []),
    ],
    patchTaskInToday,
  ),
  projection<UpcomingViewResponse>(
    upcomingKeys.all,
    (value) => value.data.groups.flatMap((group) => group.tasks),
    patchTaskInUpcoming,
  ),
  projection<CalendarViewResponse>(
    calendarKeys.all,
    (value) => value.data.tasks,
    patchTaskInCalendar,
  ),
  projection<BoardViewResponse>(
    boardViewKeys.all,
    (value) => value.data.tasks,
    (value, task) => ({
      ...value,
      data: {
        ...value.data,
        tasks: value.data.tasks.flatMap((current) =>
          current.id !== task.id ? [current] : task.deletedAt === null ? [task] : [],
        ),
        placements: value.data.placements.filter(
          (entry) => entry.taskId !== task.id || task.deletedAt === null,
        ),
      },
    }),
  ),
  projection<InfiniteData<SearchResponse>>(
    searchKeys.all,
    (value) =>
      value.pages.flatMap((page) => page.data.tasks.map((entry) => entry.task)),
    (value, task) => ({
      ...value,
      pages: value.pages.map((page) => ({
        ...page,
        data: {
          ...page.data,
          tasks: page.data.tasks.flatMap((entry) =>
            entry.task.id !== task.id
              ? [entry]
              : task.deletedAt !== null
                ? []
                : [
                    {
                      ...entry,
                      task,
                      matches: {
                        title:
                          entry.task.title === task.title ? entry.matches.title : [],
                        description:
                          entry.task.descriptionMd === task.descriptionMd
                            ? entry.matches.description
                            : [],
                      },
                    },
                  ],
          ),
        },
      })),
    }),
  ),
  ...[activityKeys.all, flowKeys.all, workspaceKeys.me()].map((key) => ({
    key,
    read: () => [],
    canRefetch: () => true,
  })),
];

function matchesKey(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

export function isTaskProjection(key: QueryKey, value: unknown): boolean {
  return taskProjections.some(
    (projection) => matchesKey(key, projection.key) && projection.canRefetch(value),
  );
}

/** Every known task, preferring the newest version; ties prefer its detail entry. */
export function cachedTasks(client: QueryClient): readonly TaskDto[] {
  const tasks = new Map<string, TaskDto>();
  for (const projection of taskProjections) {
    for (const [, value] of client.getQueriesData({ queryKey: projection.key })) {
      for (const task of projection.read(value)) {
        const previous = tasks.get(task.id);
        if (!previous || task.version > previous.version) tasks.set(task.id, task);
      }
    }
  }
  return [...tasks.values()];
}

function replaceTask(client: QueryClient, task: TaskDto): void {
  const today = workspaceToday(client);
  for (const projection of taskProjections) {
    if (!projection.patch) continue;
    for (const [key, value] of client.getQueriesData({ queryKey: projection.key })) {
      client.setQueryData(key, projection.patch(value, task, key, today));
    }
  }
}

export function patchTaskEverywhere(
  client: QueryClient,
  task: TaskDto,
  options: { readonly previous?: TaskDto | null } = {},
): void {
  const known = cachedTasks(client);
  const previous =
    options.previous === undefined
      ? known.find((candidate) => candidate.id === task.id)
      : options.previous;
  replaceTask(client, task);
  // An absent task may have just left its only projection during the optimistic patch.
  // Only an explicit null means creation; absence is not evidence of a newly added child.
  if (previous === undefined) return;
  for (const [parentId, delta] of parentProgressDeltas(previous ?? undefined, task)) {
    const parent = known.find((candidate) => candidate.id === parentId);
    if (parent) replaceTask(client, applyProgressDelta(parent, delta));
  }
}

export type TaskProjectionSnapshot = readonly (readonly [QueryKey, unknown])[];

export function snapshotTaskProjections(client: QueryClient): TaskProjectionSnapshot {
  return taskProjections.flatMap((projection) =>
    projection.patch ? client.getQueriesData({ queryKey: projection.key }) : [],
  );
}

export function restoreTaskProjections(
  client: QueryClient,
  snapshot: TaskProjectionSnapshot,
): void {
  for (const [key, value] of snapshot) client.setQueryData(key, value);
}

export function invalidateTaskProjections(client: QueryClient): void {
  void client.invalidateQueries({
    predicate: (query) => isTaskProjection(query.queryKey, query.state.data),
  });
}

export async function cancelTaskProjections(client: QueryClient): Promise<void> {
  await client.cancelQueries({
    predicate: (query) =>
      taskProjections.some((projection) => matchesKey(query.queryKey, projection.key)),
  });
}

export function workspaceToday(client: QueryClient): string {
  return (
    client.getQueryData<TodayViewResponse>(todayKeys.view())?.data.date ?? localToday()
  );
}
