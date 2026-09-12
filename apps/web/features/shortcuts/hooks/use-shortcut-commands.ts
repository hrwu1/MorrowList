"use client";

import type {
  Priority,
  TaskDto,
  TaskCommandResult,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import {
  buildCommands,
  type ShortcutDeps,
  type TaskShortcutActions,
} from "../lib/commands";
import { currentTaskKey, findTaskInCaches } from "../lib/current-task";
import { adjacentStatus, type Command } from "../lib/registry";

import { projectKeys } from "@/features/projects/hooks/use-projects";
import {
  blockedWarning,
  openSubtasksWarning,
} from "@/features/tasks/components/task-row";
import {
  taskKeys,
  useAddToDay,
  useCompleteTask,
  useDeleteTask,
  useRemoveFromDay,
  useReopenTask,
  useTaskAction,
  useUpdateTask,
} from "@/features/tasks/hooks/use-tasks";
import { useUndo } from "@/features/tasks/hooks/use-undo";
import { hasOpenSubtasks } from "@/features/tasks/lib/task-projections";
import { todayKeys } from "@/features/today/hooks/use-today";
import { localToday } from "@/features/today/lib/today-view";
import { apiClient } from "@/lib/api-client";

/**
 * The live command list (GAP-10).
 *
 * Each `run` calls an existing mutation hook, so a shortcut takes exactly the same path
 * as the button beside it: the same optimistic patch, the same rollback, the same
 * invalidation (spec 23.3), and the same warnings before completing a blocked task or a
 * task with open subtasks (spec 8.3, 8.4). Nothing about a task is decided here.
 */

export interface ShortcutSurfaceActions {
  readonly openSearch: () => void;
  readonly openCapture: () => void;
}

export interface CommandsInput {
  /** Null until the authenticated shell mounts; the auth pages have no shortcuts. */
  readonly surface: ShortcutSurfaceActions | null;
  readonly announce: (message: string) => void;
  readonly openPalette: () => void;
  readonly openCheatSheet: () => void;
  /**
   * The task that was current when a dialog opened. Focus moves into the dialog, so
   * without this the palette would lose the row the user was standing on.
   */
  readonly pinnedTaskKey: () => string | null;
}

export function useShortcutCommands(input: CommandsInput): readonly Command[] {
  const router = useRouter();
  const queryClient = useQueryClient();
  const complete = useCompleteTask();
  const reopen = useReopenTask();
  const update = useUpdateTask();
  const addToDay = useAddToDay();
  const removeFromDay = useRemoveFromDay();
  const remove = useDeleteTask();
  const undo = useUndo();
  // A status move is the move endpoint plus the shared optimistic machinery every other
  // task action already uses; the server still ranks the card and enforces the workflow.
  const moveToStatus = useTaskAction<
    {
      readonly task: TaskDto;
      readonly status: WorkflowStatusDto;
    },
    TaskCommandResult
  >(
    ({ task, status }) =>
      apiClient.moveTask(task.id, {
        projectId: status.projectId,
        statusId: status.id,
        expectedVersion: task.version,
      }),
    ({ task, status }) => ({ ...task, statusId: status.id }),
  );

  const { pinnedTaskKey } = input;

  /** Whatever task the keyboard is pointing at, from the cache first and the API second. */
  const currentTask = useCallback(async (): Promise<TaskDto | null> => {
    const key = pinnedTaskKey() ?? currentTaskKey(document, window.location);
    if (!key) return null;
    const cached = findTaskInCaches(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      key,
    );
    if (cached) return cached;
    try {
      return await queryClient.fetchQuery({
        queryKey: taskKeys.detail(key),
        queryFn: () => apiClient.getTask(key),
      });
    } catch {
      return null;
    }
  }, [pinnedTaskKey, queryClient]);

  const actions: TaskShortcutActions = {
    complete: async (task) => {
      // The same two questions the row's checkbox asks, asked from the same place in the
      // flow, so a keyboard completion cannot skip a warning the mouse would have shown.
      if (task.isBlocked && !window.confirm(blockedWarning(task))) return;
      if (hasOpenSubtasks(task) && !window.confirm(openSubtasksWarning(task))) return;
      await complete.mutateAsync(task);
    },
    reopen: async (task) => {
      await reopen.mutateAsync(task);
    },
    setPriority: async (task, priority: Priority) => {
      await update.mutateAsync({ task, patch: { priority } });
    },
    setDueDate: async (task, dueDate) => {
      await update.mutateAsync({ task, patch: { dueDate } });
    },
    addToDay: async (task) => {
      await addToDay.mutateAsync(task);
    },
    removeFromDay: async (task) => {
      await removeFromDay.mutateAsync(task);
    },
    remove: async (task) => {
      await remove.mutateAsync(task);
    },
    moveByOneColumn: async (task, direction) => {
      const projectId = task.projectId;
      if (projectId === null) return null;
      const detail = await queryClient.fetchQuery({
        queryKey: projectKeys.detail(projectId),
        queryFn: () => apiClient.getProject(projectId),
      });
      const status = adjacentStatus(detail.statuses, task.statusId, direction);
      if (!status) return null;
      await moveToStatus.mutateAsync({ task, status });
      // The card is re-parented into another column, so React drops the element that
      // had focus. Without this the next shortcut would find no task and the keyboard
      // user would be back at the top of the page (spec 14).
      refocusTask(task.key);
      return status.name;
    },
    openDetail: (task) => {
      // The row and the card already own the href for their own projection; following
      // their link keeps one definition of "open this task" rather than a second one.
      const link = taskLink(task.key);
      if (link) link.click();
      else router.push(`/tasks/${encodeURIComponent(task.key)}`);
    },
  };

  const deps: ShortcutDeps = {
    navigate: (href) => router.push(href),
    announce: input.announce,
    openSearch: () => input.surface?.openSearch(),
    openCapture: () => input.surface?.openCapture(),
    openCaptureWindow: () => {
      const popup = window.open(
        "/capture",
        "morrowlist-capture",
        "popup,width=560,height=600",
      );
      if (!popup) router.push("/capture");
    },
    openPalette: input.openPalette,
    openCheatSheet: input.openCheatSheet,
    canUndo: () => undo.entry !== null,
    undo: () => undo.undo(),
    currentTask,
    today: () => workspaceToday(queryClient),
    actions,
  };

  return buildCommands(deps);
}

/** A task's own title link, in whichever projection is on screen. */
function taskLink(key: string): HTMLElement | null {
  return (
    document.getElementById(`task-link-${key}`) ??
    document.getElementById(`board-task-link-${key}`)
  );
}

/** How long a card is given to settle before focus stops chasing it, and how often. */
const REFOCUS_WINDOW_MS = 1_200;
const REFOCUS_INTERVAL_MS = 60;

/**
 * Put focus back on a task whose element React replaced.
 *
 * A column move re-parents the card, and the refetch that follows the mutation replaces
 * it a second time a moment later, so one attempt is not enough. Focus is restored for
 * as long as the card keeps moving, and only while nothing else has claimed it: a person
 * who tabbed away in the meantime keeps where they went.
 *
 * A timer rather than an animation frame, which a browser suspends while the tab is in
 * the background — the move can complete there, and focus still has to end up right.
 */
function refocusTask(key: string): void {
  const deadline = Date.now() + REFOCUS_WINDOW_MS;
  const attempt = () => {
    const active = document.activeElement;
    const claimed = active !== null && active !== document.body;
    if (
      claimed &&
      active.id !== `task-link-${key}` &&
      active.id !== `board-task-link-${key}`
    ) {
      return;
    }
    taskLink(key)?.focus();
    if (Date.now() < deadline) window.setTimeout(attempt, REFOCUS_INTERVAL_MS);
  };
  window.setTimeout(attempt, 0);
}

/** The workspace's calendar date when a Today response has said one, else the browser's. */
function workspaceToday(queryClient: QueryClient): string {
  const cached = queryClient.getQueryData<{ readonly data: { readonly date: string } }>(
    todayKeys.view(),
  );
  return cached?.data.date ?? localToday();
}
