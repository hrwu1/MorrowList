import type { ActorRef } from "../shared/actor.js";
import { DomainError, ValidationError } from "../shared/errors.js";

import { isCompleted, isDeleted, type Task } from "./task.js";

/**
 * Task relationships (spec 8.4). `blocks` is directed: the source must be completed
 * before the target counts as unblocked. `related_to` is symmetric and stored once, in
 * canonical id order. The `type` column is reserved for `duplicates`, `informs`, and
 * friends (ADR-007); only the two MVP types are accepted here.
 */
export const RELATION_TYPES = ["blocks", "related_to"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}

export interface TaskRelation {
  readonly id: string;
  readonly workspaceId: string;
  readonly sourceTaskId: string;
  readonly targetTaskId: string;
  readonly type: RelationType;
  /** Non-authoritative extension data (spec 18.4); empty for the MVP types. */
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdBy: ActorRef;
  readonly createdAt: Date;
}

/**
 * Invariants 4, 6, and 8 (spec 8.2): no self-relation, both endpoints live in one
 * workspace, and a symmetric relation is stored with its endpoints in id order so the
 * unique index catches `A related_to B` and `B related_to A` as the same row.
 */
export function canonicalizeRelation(
  type: RelationType,
  source: Task,
  target: Task,
): { readonly sourceTaskId: string; readonly targetTaskId: string } {
  if (source.id === target.id) {
    throw new DomainError(
      "TASK_RELATION_CYCLE",
      "A task cannot be related to itself.",
      { taskId: source.id, type },
    );
  }
  if (source.workspaceId !== target.workspaceId || isDeleted(target)) {
    throw new DomainError("TASK_NOT_FOUND", "Task not found.", {
      taskId: target.id,
    });
  }
  if (type === "related_to" && target.id < source.id) {
    return { sourceTaskId: target.id, targetTaskId: source.id };
  }
  return { sourceTaskId: source.id, targetTaskId: target.id };
}

/**
 * `A blocks B` may not close a loop: if B already blocks A, directly or through other
 * tasks, the graph would contain a cycle and neither task could ever be unblocked.
 * `downstreamOfTarget` is every task reachable from the target along `blocks` edges,
 * walked to a bounded depth by the repository.
 */
export function assertNoBlocksCycle(
  sourceTaskId: string,
  targetTaskId: string,
  downstreamOfTarget: readonly string[],
): void {
  if (sourceTaskId === targetTaskId || downstreamOfTarget.includes(sourceTaskId)) {
    throw new DomainError(
      "TASK_RELATION_CYCLE",
      "That relation would create a cycle of blockers.",
      { sourceTaskId, targetTaskId },
    );
  }
}

/**
 * A task is blocked while it is open and either flagged with a reason or waiting on an
 * incomplete `blocks` predecessor (spec 8.4). Predecessors in the Trash do not count:
 * they are out of every normal view until restored.
 */
export function isBlocked(
  task: Task,
  predecessors: readonly Pick<Task, "completedAt" | "deletedAt">[],
): boolean {
  if (isCompleted(task)) return false;
  if (task.blockedReason !== null) return true;
  return predecessors.some(
    (predecessor) => !isCompleted(predecessor) && !isDeleted(predecessor),
  );
}

export const BLOCKED_REASON_MAX_LENGTH = 500;

/** A reason is required: the Kanban guides ask a blocker signal to say why. */
export function normalizeBlockedReason(raw: string): string {
  const reason = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (reason.length === 0) {
    throw new ValidationError("A blocked reason is required.", { field: "reason" });
  }
  if ([...reason].length > BLOCKED_REASON_MAX_LENGTH) {
    throw new ValidationError(
      `A blocked reason must be ${BLOCKED_REASON_MAX_LENGTH} characters or fewer.`,
      { field: "reason", maxLength: BLOCKED_REASON_MAX_LENGTH },
    );
  }
  return reason;
}
