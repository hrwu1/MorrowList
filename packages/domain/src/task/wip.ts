import type { WorkflowStatus } from "../project/status.js";
import { ValidationError } from "../shared/errors.js";

import { isCompleted, isDeleted, type Task } from "./task.js";

/**
 * Work in progress across the workspace (GAP-20). Personal Kanban limits how many things
 * a person has started at once, whichever project they belong to; a per-column limit
 * cannot express that. Like the column limits, exceeding it warns and never blocks
 * (spec 8.4).
 */

export function normalizeInProgressLimit(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationError("An in-progress limit must be a positive whole number.", {
      field: "inProgressLimit",
    });
  }
  return value;
}

/** A live, open task sitting in an active column whose category is `in_progress`. */
export function isInProgress(
  task: Task,
  statusById: ReadonlyMap<string, WorkflowStatus>,
): boolean {
  if (isDeleted(task) || isCompleted(task) || task.statusId === null) return false;
  const status = statusById.get(task.statusId);
  return status?.category === "in_progress" && status.archivedAt === null;
}

export function inProgressTasks(
  tasks: readonly Task[],
  statuses: readonly WorkflowStatus[],
): Task[] {
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  return tasks.filter((task) => isInProgress(task, statusById));
}

/** Started work across every project, which is what the workspace limit is measured against. */
export function inProgressCount(
  tasks: readonly Task[],
  statuses: readonly WorkflowStatus[],
): number {
  return inProgressTasks(tasks, statuses).length;
}

export interface WipWarning {
  readonly code: "IN_PROGRESS_LIMIT_EXCEEDED";
  readonly limit: number;
  readonly count: number;
}

/** The warning for a count against the workspace limit, or null while within it. */
export function wipWarning(count: number, limit: number | null): WipWarning | null {
  if (limit === null || count <= limit) return null;
  return { code: "IN_PROGRESS_LIMIT_EXCEEDED", limit, count };
}

/** Whether a task landing in `to` has just started: it entered an in-progress column. */
export function entersInProgress(
  from: WorkflowStatus | null,
  to: WorkflowStatus | null,
): boolean {
  return to?.category === "in_progress" && from?.category !== "in_progress";
}
