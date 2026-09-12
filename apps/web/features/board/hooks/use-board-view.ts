"use client";

import type { BoardViewQuery, TaskDto, WipWarningDto } from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { boardViewKeys } from "../lib/board-keys";
import type { BoardDropStep } from "../lib/board-view";

import { useTaskFeedback } from "@/features/tasks/hooks/use-task-feedback";
import {
  invalidateTaskProjections,
  patchTaskEverywhere,
} from "@/features/tasks/lib/task-cache";
import { apiClient } from "@/lib/api-client";

export function useBoardView(query: Partial<BoardViewQuery>) {
  return useQuery({
    queryKey: boardViewKeys.view(query),
    queryFn: () => apiClient.getBoardView(query),
  });
}

export interface BoardDropInputs {
  readonly task: TaskDto;
  readonly steps: readonly BoardDropStep[];
}

export interface BoardDropResult {
  readonly task: TaskDto;
  readonly warnings: readonly WipWarningDto[];
}

/**
 * Apply what a drop meant, one ordinary command at a time (GAP-19).
 *
 * A card can cross a column and a lane in one gesture, and those are two different
 * changes to the task: each goes through the command that owns it, in order, carrying the
 * version the previous one returned so a stale card is still refused. No optimistic patch
 * here on purpose — a cross-lane drop can change project, status and priority at once,
 * and guessing all three client-side is how a board starts lying about the task model.
 */
export function useBoardDrop() {
  const queryClient = useQueryClient();
  const { report } = useTaskFeedback();

  return useMutation({
    mutationFn: async ({ task, steps }: BoardDropInputs): Promise<BoardDropResult> => {
      let current = task;
      const warnings: WipWarningDto[] = [];

      for (const step of steps) {
        switch (step.kind) {
          case "reorder":
            current = await apiClient.reorderTask(current.id, {
              beforeTaskId: step.placement.beforeTaskId,
              afterTaskId: step.placement.afterTaskId,
              expectedVersion: current.version,
            });
            break;
          case "move": {
            const result = await apiClient.moveTask(current.id, {
              projectId: step.projectId,
              ...(step.statusId ? { statusId: step.statusId } : {}),
              ...(step.statusCategory ? { statusCategory: step.statusCategory } : {}),
              beforeTaskId: step.placement.beforeTaskId,
              afterTaskId: step.placement.afterTaskId,
              expectedVersion: current.version,
            });
            current = result.task;
            warnings.push(...result.warnings);
            break;
          }
          case "priority":
            current = await apiClient.updateTask(current.id, {
              priority: step.priority,
              expectedVersion: current.version,
            });
            break;
          case "tag":
            if (step.removeTagId) {
              current = await apiClient.removeTaskTag(current.id, step.removeTagId);
            }
            if (step.addTagId) {
              current = await apiClient.addTaskTag(current.id, step.addTagId);
            }
            break;
          case "complete":
            current = await apiClient.completeTask(current.id, {
              expectedVersion: current.version,
            });
            break;
          case "reopen": {
            const result = await apiClient.reopenTask(current.id, current.version);
            current = result.task;
            warnings.push(...result.warnings);
            break;
          }
        }
      }

      return { task: current, warnings };
    },
    onSuccess: (result, { task }) => {
      patchTaskEverywhere(queryClient, result.task, { previous: task });
      report(result);
    },
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}
