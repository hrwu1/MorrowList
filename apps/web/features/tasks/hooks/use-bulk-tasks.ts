"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  bulkVerb,
  inverseOperations,
  toOperations,
  type BulkAction,
} from "../lib/bulk";
import { undoBatchLabel } from "../lib/undo";

import {
  cachedTasks,
  invalidateTaskProjections,
  patchTaskEverywhere,
} from "./use-tasks";
import { useUndo } from "./use-undo";

import { useTaskFeedback } from "@/features/tasks/hooks/use-task-feedback";
import { apiClient } from "@/lib/api-client";

/**
 * One bulk change, applied through the batch endpoint (spec 10.4).
 *
 * The whole selection goes to the server as one transaction, so the answer is never "nine
 * of your twelve tasks moved". It is not applied optimistically: a bulk change is a
 * deliberate act that the user is watching, and a rollback across a dozen rows in several
 * projections is a worse failure mode than a moment of waiting.
 *
 * What comes back is patched through the same canonical patch every single-item mutation
 * uses, and leaves a single undo offer for the whole batch (GAP-08).
 */

export interface BulkTasksInput {
  readonly action: BulkAction;
  readonly tasks: readonly TaskDto[];
}

export function useBulkTasks() {
  const queryClient = useQueryClient();
  const { report } = useTaskFeedback();
  const { offer } = useUndo();

  return useMutation({
    mutationFn: ({ action, tasks }: BulkTasksInput) =>
      apiClient.batchTasks({ operations: [...toOperations(action, tasks)] }),
    onSuccess: (result, { action, tasks }) => {
      report(result);
      // The positions an undone move has to restore are read before the cache moves on.
      const candidates = cachedTasks(queryClient);
      for (const item of result.data)
        patchTaskEverywhere(queryClient, item.data, {
          previous: tasks.find((task) => task.id === item.taskId),
        });

      const inverse = inverseOperations(action, tasks, result.data, candidates);
      if (inverse.length > 0) {
        offer({
          id: `batch:${result.data.map((item) => item.taskId).join(",")}`,
          label: undoBatchLabel(bulkVerb(action), result.data.length),
          compensate: () => apiClient.batchTasks({ operations: [...inverse] }),
        });
      }
    },
    onSettled: () => invalidateTaskProjections(queryClient),
  });
}
