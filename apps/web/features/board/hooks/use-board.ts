"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { projectKeys } from "../../projects/hooks/use-projects";
import { moveTaskInBoard, type BoardPlacement } from "../lib/board-view";

import { taskKeys } from "@/features/tasks/hooks/use-tasks";
import { apiClient } from "@/lib/api-client";

export function useProjectBoard(projectId: string) {
  return useQuery({
    queryKey: projectKeys.board(projectId),
    queryFn: () => apiClient.getProjectBoard(projectId, { limit: 500 }),
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
 * The server still computes the authoritative rank and completion transition.
 */
export function useMoveBoardTask(projectId: string) {
  const queryClient = useQueryClient();
  const boardKey = projectKeys.board(projectId);

  return useMutation({
    mutationFn: async (input: MoveBoardTaskInput) => {
      const neighbours = {
        beforeTaskId: input.placement.beforeTaskId,
        afterTaskId: input.placement.afterTaskId,
        expectedVersion: input.task.version,
      };
      return input.task.statusId === input.destination.id
        ? apiClient.reorderTask(input.task.id, neighbours)
        : apiClient.moveTask(input.task.id, {
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
      const previous = queryClient.getQueryData<ProjectBoardResponse>(boardKey);
      if (previous) {
        queryClient.setQueryData<ProjectBoardResponse>(
          boardKey,
          moveTaskInBoard(previous, {
            taskId: input.task.id,
            placement: input.placement,
            destination: input.destination,
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
    },
    onSuccess: (task, input) => {
      queryClient.setQueryData<ProjectBoardResponse>(boardKey, (current) =>
        current
          ? moveTaskInBoard(current, {
              taskId: input.task.id,
              placement: input.placement,
              destination: input.destination,
              authoritativeTask: task,
            })
          : current,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: boardKey });
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function isMoveConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "TASK_VERSION_CONFLICT";
}
