"use client";

import type { Priority, TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
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
  // A status move is the move endpoint plus the shared optimistic machinery every other
  // task action already uses; the server still ranks the card and enforces the workflow.
  const moveToStatus = useTaskAction<{
    readonly task: TaskDto;
    readonly status: WorkflowStatusDto;
  }>(
    ({ task, status }) =>
      apiClient
        .moveTask(task.id, {
          projectId: status.projectId,
          statusId: status.id,
          expectedVersion: task.version,
        })
        .then((result) => result.task),
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
      return status.name;
    },
    openDetail: (task) => {
      // The row and the card already own the href for their own projection; following
      // their link keeps one definition of "open this task" rather than a second one.
      const link =
        document.getElementById(`task-link-${task.key}`) ??
        document.getElementById(`board-task-link-${task.key}`);
      if (link) link.click();
      else router.push(`/tasks/${encodeURIComponent(task.key)}`);
    },
  };

  const deps: ShortcutDeps = {
    navigate: (href) => router.push(href),
    announce: input.announce,
    openSearch: () => input.surface?.openSearch(),
    openCapture: () => openQuickAdd(input.surface),
    openPalette: input.openPalette,
    openCheatSheet: input.openCheatSheet,
    currentTask,
    today: () => workspaceToday(queryClient),
    actions,
  };

  return buildCommands(deps);
}

/**
 * Capture goes to the quick add that is already on screen when there is one — the board
 * and the list both render one — and to the Inbox tray otherwise. Either way this only
 * moves focus; the capture form itself is untouched.
 */
function openQuickAdd(surface: ShortcutSurfaceActions | null): void {
  const field = document.querySelector<HTMLInputElement>(
    'form[aria-label="Quick add"] input:not([type="hidden"])',
  );
  if (field && field.offsetParent !== null) {
    field.focus();
    return;
  }
  surface?.openCapture();
}

/** The workspace's calendar date when a Today response has said one, else the browser's. */
function workspaceToday(queryClient: QueryClient): string {
  const cached = queryClient.getQueryData<{ readonly data: { readonly date: string } }>(
    todayKeys.view(),
  );
  return cached?.data.date ?? localToday();
}
