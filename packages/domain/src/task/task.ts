import type { ActorRef } from "../shared/actor.js";

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
  readonly dueDate: PlainDate | null;
  readonly dueTime: PlainTime | null;
  readonly dueTimezone: string | null;
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

/** Human-readable key: workspace prefix plus monotonic number, e.g. `ML-142` (spec 8.1). */
export function taskKey(prefix: string, taskNumber: number): string {
  return `${prefix}-${taskNumber}`;
}

const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/;

/** Parse a task key. Returns null when the input is not a key, e.g. when it is a UUID. */
export function parseTaskKey(
  value: string,
): { prefix: string; taskNumber: number } | null {
  const match = TASK_KEY_PATTERN.exec(value.trim().toUpperCase());
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
