import type { ActorRef } from "../shared/actor.js";

import type { FieldValues } from "./fields.js";
import type { RecurrenceRule } from "./recurrence.js";
import type { Priority, PlainDate, PlainTime } from "./values.js";

/**
 * The canonical task (spec 8.1). Every projection — Inbox, Today, board, search — reads
 * this one entity; none of them owns a competing model (ADR-001, ADR-002).
 *
 * The shape is immutable: policies in `policies.ts` return a new task plus the changes to
 * persist, so a caller cannot mutate a task without going through a policy.
 */
export interface Task {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskNumber: number;
  readonly projectId: string | null;
  readonly statusId: string | null;
  readonly title: string;
  readonly descriptionMd: string | null;
  readonly priority: Priority;
  /** The day the task is planned to be done (spec 8.1 "due date"). */
  readonly dueDate: PlainDate | null;
  readonly dueTime: PlainTime | null;
  readonly dueTimezone: string | null;
  /** Hidden from Today, Upcoming, the Inbox and the board until this day (GAP-16). */
  readonly deferUntil: PlainDate | null;
  /** The hard limit, distinct from the planned day; shown as its own marker (GAP-16). */
  readonly deadline: PlainDate | null;
  /** Wall-clock time of the deadline in the workspace timezone; requires `deadline`. */
  readonly deadlineTime: PlainTime | null;
  /**
   * Minutes before the due instant a reminder fires; null means no reminder. Only a task
   * with a due time can carry one (GAP-13).
   */
  readonly reminderOffsetMinutes: number | null;
  /**
   * Values of the workspace's typed custom fields, keyed by the definition's key
   * (GAP-24). A slot on the canonical task, never a second model: `{}` when unset.
   */
  readonly fields: FieldValues;
  readonly parentTaskId: string | null;
  /** How the task repeats; completing it creates the next occurrence (GAP-12). */
  readonly recurrence: RecurrenceRule | null;
  /** Links every occurrence of one repeating task: the id of the first of them. */
  readonly seriesId: string | null;
  readonly rank: string;
  readonly lastActiveStatusId: string | null;
  readonly completedAt: Date | null;
  /**
   * The explicit blocker flag (spec 8.4, GAP-06): why the task cannot move, and since
   * when. Independent of `blocks` relations, and both null or both set.
   */
  readonly blockedReason: string | null;
  readonly blockedSince: Date | null;
  readonly version: number;
  readonly createdBy: ActorRef;
  readonly lastActor: ActorRef;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly deletedBy: ActorRef | null;
}

/** How wide the number renders. Beyond this it grows a digit rather than being capped. */
const TASK_NUMBER_WIDTH = 6;

/**
 * Human-readable key: workspace prefix plus monotonic number, e.g. `MorrowList-000142`
 * (spec 8.1). The number is zero-padded so keys line up in a list; the padding is purely
 * presentational, and `parseTaskKey` reads padded and bare numbers alike.
 */
export function taskKey(prefix: string, taskNumber: number): string {
  return `${prefix}-${String(taskNumber).padStart(TASK_NUMBER_WIDTH, "0")}`;
}

/**
 * The number alone, for text that refers to a task other than the one it hangs off. It
 * carries no prefix, so it stays correct when a workspace renames its prefix.
 */
export function taskNumberRef(taskNumber: number): string {
  return `#${String(taskNumber).padStart(TASK_NUMBER_WIDTH, "0")}`;
}

// Case-insensitive: prefixes are stored as typed, so a key may be typed in any case.
const TASK_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{0,23})-(\d+)$/;

/**
 * Parse a task key. Returns null when the input is not a key, e.g. when it is a UUID.
 * The prefix comes back as it was written; callers that compare it should fold case.
 */
export function parseTaskKey(
  value: string,
): { prefix: string; taskNumber: number } | null {
  const match = TASK_KEY_PATTERN.exec(value.trim());
  if (!match) return null;
  const taskNumber = Number(match[2]);
  if (!Number.isSafeInteger(taskNumber) || taskNumber < 1) return null;
  return { prefix: match[1] as string, taskNumber };
}

export function isCompleted(task: Task): boolean {
  return task.completedAt !== null;
}

export function isDeleted(task: Task): boolean {
  return task.deletedAt !== null;
}

/** A task with no project is an Inbox task (spec 8.2 invariant 1). */
export function isInboxTask(task: Task): boolean {
  return task.projectId === null;
}

/**
 * A task is deferred while its defer date is still ahead of the workspace's calendar
 * date (GAP-16). Pure date comparison at read time: nothing rewrites the task when the
 * day arrives, so a deferred task returns on its own, like a My Day selection expires.
 */
export function isDeferred(task: Task, today: PlainDate): boolean {
  return task.deferUntil !== null && task.deferUntil > today;
}

/** Overdue is judged on the planned day; this is the harder question (GAP-16). */
export function isPastDeadline(task: Task, today: PlainDate): boolean {
  return task.deadline !== null && task.deadline < today;
}

/**
 * The expected order is `deferUntil ≤ dueDate ≤ deadline`. Breaking it is allowed, because
 * real plans break it; the codes let a client warn without the command refusing.
 */
export const DATE_WARNINGS = [
  "defer_after_due",
  "due_after_deadline",
  "defer_after_deadline",
] as const;
export type DateWarning = (typeof DATE_WARNINGS)[number];

export function dateOrderWarnings(task: Task): DateWarning[] {
  const warnings: DateWarning[] = [];
  if (
    task.deferUntil !== null &&
    task.dueDate !== null &&
    task.deferUntil > task.dueDate
  ) {
    warnings.push("defer_after_due");
  }
  if (task.dueDate !== null && task.deadline !== null && task.dueDate > task.deadline) {
    warnings.push("due_after_deadline");
  }
  if (
    task.deferUntil !== null &&
    task.deadline !== null &&
    task.deferUntil > task.deadline
  ) {
    warnings.push("defer_after_deadline");
  }
  return warnings;
}
