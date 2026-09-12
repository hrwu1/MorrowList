"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type {
  ProjectBoardResponse,
  TaskCommandResult,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { projectKeys, type BoardViewOptions } from "../../projects/hooks/use-projects";
import { moveTaskInBoard, type BoardPlacement } from "../lib/board-view";

import { useUndo } from "@/features/tasks/hooks/use-undo";
import {
  cachedTasks,
  patchTaskEverywhere,
  invalidateTaskProjections,
  cancelTaskProjections,
  snapshotTaskProjections,
  restoreTaskProjections,
} from "@/features/tasks/lib/task-cache";
import { neighboursOf, undoLabel } from "@/features/tasks/lib/undo";
import { apiClient } from "@/lib/api-client";

export function useProjectBoard(
  projectId: string,
  view: BoardViewOptions = {
    includeSubtasks: false,
    includeDeferred: false,
    swimlaneBy: "none",
  },
) {
  return useQuery({
    queryKey: projectKeys.board(projectId, view),
    queryFn: () => apiClient.getProjectBoard(projectId, { limit: 500, ...view }),
  });
}

export interface MoveBoardTaskInput {
  readonly task: TaskDto;
  readonly projectId: string;
  readonly destination: WorkflowStatusDto;
  readonly placement: BoardPlacement;
}

/**
 * One optimistic move path for pointer drag, keyboard drag, and the Move menu.
 * The server still computes the authoritative rank and completion transition, and
 * answers with any cross-project in-progress warning (GAP-20) for the caller to show.
 */
export function useMoveBoardTask(projectId: string) {
  const queryClient = useQueryClient();
  const { offer } = useUndo();
  // Every cached variant of this board (subtasks hidden or shown) moves together.
  const boardKey = projectKeys.projectBoards(projectId);

  return useMutation({
    mutationFn: async (input: MoveBoardTaskInput): Promise<TaskCommandResult> => {
      const neighbours = {
        beforeTaskId: input.placement.beforeTaskId,
        afterTaskId: input.placement.afterTaskId,
        expectedVersion: input.task.version,
      };
      if (input.task.statusId === input.destination.id) {
        const task = await apiClient.reorderTask(input.task.id, neighbours);
        return { task, warnings: [] };
      }
      return apiClient.moveTask(input.task.id, {
        projectId: input.projectId,
        statusId: input.destination.id,
        ...neighbours,
      });
    },
    onMutate: async (input) => {
      await cancelTaskProjections(queryClient);
      const previous = snapshotTaskProjections(queryClient);
      // Where the card sits now, read before the optimistic patch moves it: this is the
      // position an undo has to restore.
      const origin = neighboursOf(input.task, cachedTasks(queryClient));
      queryClient.setQueriesData<ProjectBoardResponse>(
        { queryKey: boardKey },
        (current) =>
          current
            ? moveTaskInBoard(current, {
                taskId: input.task.id,
                placement: input.placement,
                destination: input.destination,
              })
            : current,
      );
      return { previous, origin };
    },
    onError: (_error, _input, context) => {
      if (context) restoreTaskProjections(queryClient, context.previous);
    },
    onSuccess: (result, input, context) => {
      // A card may open immediately after its move. Detail/list caches must already
      // carry the committed version, even while their background refetch is pending.
      patchTaskEverywhere(queryClient, result.task, { previous: input.task });
      queryClient.setQueriesData<ProjectBoardResponse>(
        { queryKey: boardKey },
        (current) =>
          current
            ? moveTaskInBoard(current, {
                taskId: input.task.id,
                placement: input.placement,
                destination: input.destination,
                authoritativeTask: result.task,
              })
            : current,
      );
      // Undo puts the card back in the column it came from and between the same two
      // cards, using the version this move produced: a card someone else has since moved
      // reports a conflict instead of being dragged back over their change (spec 24.3).
      offer({
        id: result.task.id,
        label: undoLabel("Moved", result.task),
        compensate: async () => {
          await apiClient.moveTask(result.task.id, {
            projectId: input.task.projectId,
            ...(input.task.statusId ? { statusId: input.task.statusId } : {}),
            ...context.origin,
            expectedVersion: result.task.version,
          });
          invalidateTaskProjections(queryClient);
        },
      });
    },
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}

export function isMoveConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "TASK_VERSION_CONFLICT";
}
