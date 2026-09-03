import { isActive, isTerminal, type WorkflowStatus } from "../project/status.js";
import { DomainError, ValidationError } from "../shared/errors.js";

import type { Task } from "./task.js";

/** Maximum displayed nesting depth for subtasks (spec 8.3). */
export const MAX_NESTING_DEPTH = 3;

/**
 * Enforces the task invariants of spec 8.2. Called by every policy before a task is
 * returned, so no code path can persist a task that violates them.
 */
export function assertTaskInvariants(task: Task): void {
  // 1. A task with no project must have no status and appears in Inbox.
  if (task.projectId === null && task.statusId !== null) {
    throw new DomainError(
      "TASK_INVALID_STATUS",
      "An Inbox task cannot have a workflow status.",
      { taskId: task.id },
    );
  }

  // 2. A task with a project must reference a status of that project. The status/project
  //    pairing itself is checked against loaded statuses in `assertStatusBelongsToProject`.
  if (task.projectId !== null && task.statusId === null) {
    throw new DomainError(
      "TASK_INVALID_STATUS",
      "A task in a project must have a workflow status.",
      { taskId: task.id, projectId: task.projectId },
    );
  }

  // 3. A due time must not exist without a due date.
  if (task.dueTime !== null && task.dueDate === null) {
    throw new ValidationError("A due time requires a due date.", {
      field: "dueTime",
      taskId: task.id,
    });
  }

  // A stored due time is meaningless without the zone it was entered in (spec 12.3).
  if (task.dueTime !== null && task.dueTimezone === null) {
    throw new ValidationError("A due time requires a due timezone.", {
      field: "dueTimezone",
      taskId: task.id,
    });
  }

  // A deadline time cannot exist without a deadline, for the same reason (GAP-16).
  if (task.deadlineTime !== null && task.deadline === null) {
    throw new ValidationError("A deadline time requires a deadline.", {
      field: "deadlineTime",
      taskId: task.id,
    });
  }

  // A reminder is an offset from the due instant, so it needs a due time (GAP-13).
  if (task.reminderOffsetMinutes !== null && task.dueTime === null) {
    throw new ValidationError("A reminder requires a due time.", {
      field: "reminderOffsetMinutes",
      taskId: task.id,
    });
  }

  // 4. A task must not be its own parent.
  if (task.parentTaskId !== null && task.parentTaskId === task.id) {
    throw new DomainError("TASK_RELATION_CYCLE", "A task cannot be its own parent.", {
      taskId: task.id,
    });
  }

  // A blocker flag carries its reason and its start together (spec 8.4).
  if ((task.blockedReason === null) !== (task.blockedSince === null)) {
    throw new ValidationError("A blocked reason and its start time go together.", {
      taskId: task.id,
    });
  }

  // 12. Version is monotonic and starts at 1.
  if (!Number.isInteger(task.version) || task.version < 1) {
    throw new ValidationError("Task version must be a positive integer.", {
      taskId: task.id,
      version: task.version,
    });
  }
}

/** Invariant 2: the referenced status must belong to the project and be active. */
export function assertStatusBelongsToProject(
  projectId: string,
  status: WorkflowStatus,
): void {
  if (status.projectId !== projectId) {
    throw new DomainError(
      "TASK_INVALID_STATUS",
      "The selected status belongs to a different project.",
      { projectId, statusId: status.id, statusProjectId: status.projectId },
    );
  }
  if (!isActive(status)) {
    throw new DomainError("TASK_INVALID_STATUS", "The selected status is archived.", {
      projectId,
      statusId: status.id,
    });
  }
}

/**
 * Invariant 9: a completed task has `completed_at`; an incomplete task has null. The
 * timestamp and the terminal status must agree for a project task (spec 8.5).
 */
export function assertCompletionConsistency(
  task: Task,
  status: WorkflowStatus | null,
): void {
  if (task.projectId === null || status === null) return;

  const inTerminalStatus = isTerminal(status);
  if (inTerminalStatus && task.completedAt === null) {
    throw new ValidationError(
      "A task in a Done status must have a completion timestamp.",
      { taskId: task.id, statusId: status.id },
    );
  }
  if (!inTerminalStatus && task.completedAt !== null) {
    throw new ValidationError("A completed task must be in a Done status.", {
      taskId: task.id,
      statusId: status.id,
    });
  }
}

/**
 * Invariant 5: parent chains must not contain cycles, and nesting must stay within
 * `MAX_NESTING_DEPTH`. `ancestorIds` runs from the prospective parent upward.
 */
export function assertParentIsAssignable(
  taskId: string,
  parentTaskId: string,
  ancestorIds: readonly string[],
  descendantDepth: number,
): void {
  if (taskId === parentTaskId) {
    throw new DomainError("TASK_RELATION_CYCLE", "A task cannot be its own parent.", {
      taskId,
    });
  }
  if (ancestorIds.includes(taskId)) {
    throw new DomainError(
      "TASK_RELATION_CYCLE",
      "That parent would create a cycle in the subtask chain.",
      { taskId, parentTaskId },
    );
  }

  // Depth of the resulting tree: ancestors above the new parent, the parent itself, this
  // task, and anything already hanging below it.
  const resultingDepth = ancestorIds.length + 2 + descendantDepth;
  if (resultingDepth > MAX_NESTING_DEPTH) {
    throw new DomainError(
      "TASK_NESTING_LIMIT_EXCEEDED",
      `Subtasks may nest at most ${MAX_NESTING_DEPTH} levels deep.`,
      { taskId, parentTaskId, resultingDepth, maxDepth: MAX_NESTING_DEPTH },
    );
  }
}
