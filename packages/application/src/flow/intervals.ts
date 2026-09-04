import {
  DomainError,
  boardPlacement,
  intervalTransition,
  uuidv7,
  type BoardPlacement,
  type Task,
  type WorkflowStatus,
} from "@morrowlist/domain";

import type { TransactionContext } from "../ports/index.js";

/**
 * Interval writers for the flow read model (GAP-17). Every command that changes where a
 * task sits calls one of these inside its own transaction, whether the task moved on its
 * own (`TaskService`) or its column moved under it (`WorkflowService`), so the table can
 * never fall behind the tasks it describes.
 */

/** Leaving a board position closes the open interval; arriving at one opens the next. */
export async function syncIntervals(
  tx: TransactionContext,
  previous: Task,
  next: Task,
  status?: WorkflowStatus,
): Promise<void> {
  const transition = intervalTransition(previous, next);
  if (transition.closes) await tx.statusIntervals.close(next.id, next.updatedAt);
  if (transition.opens) await openInterval(tx, next, transition.opens, status);
}

/**
 * The task stayed put but its column changed category (a Done column became active or
 * the reverse): its stay ends and a new one begins so the interval's category is what
 * the task experienced, exactly as if it had been moved between two columns.
 */
export async function reenterInterval(
  tx: TransactionContext,
  task: Task,
  status: WorkflowStatus,
): Promise<void> {
  await tx.statusIntervals.close(task.id, task.updatedAt);
  const placement = boardPlacement(task);
  if (placement) await openInterval(tx, task, placement, status);
}

export async function openInterval(
  tx: TransactionContext,
  task: Task,
  placement: BoardPlacement,
  status?: WorkflowStatus,
): Promise<void> {
  const resolved = status ?? (await tx.statuses.findById(placement.statusId));
  if (!resolved) {
    throw new DomainError("STATUS_NOT_FOUND", "Status not found.", {
      statusId: placement.statusId,
    });
  }
  await tx.statusIntervals.open({
    id: uuidv7(),
    taskId: task.id,
    workspaceId: task.workspaceId,
    projectId: placement.projectId,
    statusId: resolved.id,
    category: resolved.category,
    enteredAt: task.updatedAt,
  });
}
