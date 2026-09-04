"use client";

import type { RelationType, TaskDto, TaskRelationDto } from "@morrowlist/contracts";

import { withBlockedFlag, withoutBlockedFlag } from "../lib/relations";

import { useTaskAction } from "@/features/tasks/hooks/use-tasks";
import { apiClient } from "@/lib/api-client";

/**
 * Relation and blocker mutations, all through the one shared task patch (spec 23.3).
 * The flag is guessed optimistically; a relation is not, because the server decides
 * cycles and the other endpoint's projection changes with it — the invalidation that
 * follows every action refreshes both tasks.
 */

export interface SetTaskBlockedInput {
  readonly task: TaskDto;
  readonly reason: string;
}

export function useSetTaskBlocked() {
  return useTaskAction<SetTaskBlockedInput>(
    ({ task, reason }) =>
      apiClient.setTaskBlocked(task.id, { reason, expectedVersion: task.version }),
    ({ task, reason }) => withBlockedFlag(task, reason, new Date().toISOString()),
  );
}

export function useClearTaskBlocked() {
  return useTaskAction(
    (task) => apiClient.clearTaskBlocked(task.id, task.version),
    (task) => withoutBlockedFlag(task),
  );
}

export interface AddTaskRelationInput {
  readonly task: TaskDto;
  readonly type: RelationType;
  /** For `blocks`, whether `other` blocks `task` (incoming) or the reverse. */
  readonly direction: "incoming" | "outgoing";
  readonly other: { readonly id: string };
}

export function useAddTaskRelation() {
  return useTaskAction<AddTaskRelationInput>(
    ({ task, type, direction, other }) =>
      direction === "incoming"
        ? apiClient
            .addTaskRelation(other.id, { type, targetTaskId: task.id })
            // The response describes the other task; the caller's own task is refreshed
            // by the invalidation, so return the task we already hold.
            .then(() => apiClient.getTask(task.id))
        : apiClient.addTaskRelation(task.id, { type, targetTaskId: other.id }),
    ({ task }) => task,
  );
}

export interface RemoveTaskRelationInput {
  readonly task: TaskDto;
  readonly relation: TaskRelationDto;
}

export function useRemoveTaskRelation() {
  return useTaskAction<RemoveTaskRelationInput>(
    ({ task, relation }) => apiClient.removeTaskRelation(task.id, relation.id),
    ({ task, relation }) => {
      const relations = task.relations.filter((r) => r.id !== relation.id);
      const stillBlocked =
        task.blocked !== null ||
        relations.some(
          (r) =>
            r.type === "blocks" && r.targetTaskId === task.id && !r.task.isCompleted,
        );
      return { ...task, relations, isBlocked: !task.isCompleted && stillBlocked };
    },
  );
}
