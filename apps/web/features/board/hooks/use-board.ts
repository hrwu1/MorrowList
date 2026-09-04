"use client";

import { ApiClientError } from "@morrowlist/api-client";
import type {
  ProjectBoardResponse,
  TaskCommandResult,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { projectKeys } from "../../projects/hooks/use-projects";
import { moveTaskInBoard, type BoardPlacement } from "../lib/board-view";

import { activityKeys } from "@/features/activity/hooks/use-activity";
import { flowKeys } from "@/features/flow/hooks/use-flow";
import { taskKeys } from "@/features/tasks/hooks/use-tasks";
import { workspaceKeys } from "@/features/workspace/hooks/use-workspace";
import { apiClient } from "@/lib/api-client";

export function useProjectBoard(projectId: string, includeSubtasks = false) {
  return useQuery({
    queryKey: projectKeys.board(projectId, includeSubtasks),
    queryFn: () =>
      apiClient.getProjectBoard(projectId, { limit: 500, includeSubtasks }),
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
      return { previous };
    },
    onError: (_error, _input, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value);
      }
    },
    onSuccess: (result, input) => {
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
