import type { TaskDto, TaskRelationDto } from "@morrowlist/contracts";

/**
 * Pure presentation rules for relations and the blocker flag (spec 8.4). A task's
 * `relations` list every edge it is on; these split it by direction from the task's own
 * point of view so a component never has to compare ids itself.
 */

/** Tasks that must complete before this one is unblocked. */
export function blockedBy(task: TaskDto): TaskRelationDto[] {
  return task.relations.filter(
    (relation) => relation.type === "blocks" && relation.targetTaskId === task.id,
  );
}

/** Tasks waiting on this one. */
export function blocks(task: TaskDto): TaskRelationDto[] {
  return task.relations.filter(
    (relation) => relation.type === "blocks" && relation.sourceTaskId === task.id,
  );
}

export function relatedTo(task: TaskDto): TaskRelationDto[] {
  return task.relations.filter((relation) => relation.type === "related_to");
}

/** The predecessors still open: what the Blocked indicator is actually about. */
export function openBlockers(task: TaskDto): TaskRelationDto[] {
  return blockedBy(task).filter((relation) => !relation.task.isCompleted);
}

/**
 * Why the task is blocked, in one line for a tooltip or a warning: the flag's reason
 * first, then the open predecessors by key. Null when nothing blocks it.
 */
export function blockedSummary(task: TaskDto): string | null {
  if (!task.isBlocked) return null;
  const parts: string[] = [];
  if (task.blocked) parts.push(task.blocked.reason);
  const blockers = openBlockers(task);
  if (blockers.length > 0) {
    parts.push(
      `Waiting on ${blockers.map((relation) => `${relation.task.key} ${relation.task.title}`).join(", ")}`,
    );
  }
  return parts.join(" · ") || "Blocked";
}

/** The optimistic shape of a task the moment it is flagged (spec 23.3). */
export function withBlockedFlag(task: TaskDto, reason: string, since: string): TaskDto {
  return {
    ...task,
    blocked: { reason, since: task.blocked?.since ?? since },
    isBlocked: !task.isCompleted,
  };
}

/** The optimistic shape once the flag is cleared: open blockers may still apply. */
export function withoutBlockedFlag(task: TaskDto): TaskDto {
  return {
    ...task,
    blocked: null,
    isBlocked: !task.isCompleted && openBlockers(task).length > 0,
  };
}
