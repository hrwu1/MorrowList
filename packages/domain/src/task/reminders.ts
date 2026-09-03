import { isCompleted, isDeleted, type Task } from "./task.js";
import { toInstant } from "./values.js";

/**
 * Reminder scheduling (GAP-13). The reminder is derived from the canonical task — its due
 * instant minus the task's offset — so it is recomputed whenever the task changes rather
 * than stored as a second source of truth (ADR-001).
 */

/** One scheduled reminder: the pending row in `task_reminders`. */
export interface Reminder {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly remindAt: Date;
  readonly offsetMinutes: number;
  readonly deliveredAt: Date | null;
}

/** Snooze from a notification re-arms the reminder this far ahead (the only snooze offered). */
export const SNOOZE_MINUTES = 60;

/** The due instant of a timed task, or null for a date-only or undated task. */
export function dueInstant(task: Task, workspaceTimezone: string): Date | null {
  if (task.dueDate === null || task.dueTime === null) return null;
  return toInstant(task.dueDate, task.dueTime, task.dueTimezone ?? workspaceTimezone);
}

/**
 * When a task's reminder should fire, or null when it should not exist: the task is done,
 * trashed, undated, has no offset, or the instant has already passed. A reminder for a
 * moment that is already behind us would only be noise (spec 15, "no manipulative
 * notifications").
 */
export function scheduleReminder(
  task: Task,
  workspaceTimezone: string,
  now: Date,
): Date | null {
  if (isCompleted(task) || isDeleted(task) || task.reminderOffsetMinutes === null) {
    return null;
  }
  const due = dueInstant(task, workspaceTimezone);
  if (due === null) return null;
  const remindAt = new Date(due.getTime() - task.reminderOffsetMinutes * 60_000);
  return remindAt.getTime() > now.getTime() ? remindAt : null;
}
