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

import { activityKeys } from "@/features/activity/hooks/use-activity";
import { flowKeys } from "@/features/flow/hooks/use-flow";
import { cachedTasks, taskKeys } from "@/features/tasks/hooks/use-tasks";
import { useUndo } from "@/features/tasks/hooks/use-undo";
import { neighboursOf, undoLabel } from "@/features/tasks/lib/undo";
import { workspaceKeys } from "@/features/workspace/hooks/use-workspace";
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
      await Promise.all([
        queryClient.cancelQueries({ queryKey: boardKey }),
        queryClient.cancelQueries({ queryKey: taskKeys.all }),
      ]);
      const previous = queryClient.getQueriesData<ProjectBoardResponse>({
        queryKey: boardKey,
      });
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
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value);
      }
    },
    onSuccess: (result, input, context) => {
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
          void queryClient.invalidateQueries({ queryKey: boardKey });
          void queryClient.invalidateQueries({ queryKey: taskKeys.all });
        },
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
      void queryClient.invalidateQueries({ queryKey: activityKeys.all });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.me() });
      void queryClient.invalidateQueries({ queryKey: flowKeys.all });
    },
  });
}

export function isMoveConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "TASK_VERSION_CONFLICT";
}
