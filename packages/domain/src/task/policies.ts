import { isActive, isTerminal, type WorkflowStatus } from "../project/status.js";
import type { ActorRef } from "../shared/actor.js";
import type { Clock } from "../shared/clock.js";
import {
  DomainError,
  ValidationError,
  VersionConflictError,
} from "../shared/errors.js";

import {
  assertCompletionConsistency,
  assertParentIsAssignable,
  assertStatusBelongsToProject,
  assertTaskInvariants,
} from "./invariants.js";
import { isCompleted, isDeleted, type Task } from "./task.js";
import {
  normalizeDescription,
  normalizeTitle,
  type PlainDate,
  type PlainTime,
  type Priority,
} from "./values.js";

/**
 * Task policies (spec 8.2, 8.5). Each returns a new `Task`; none performs I/O. The
 * application layer supplies loaded statuses, allocates identifiers, and persists the
 * result together with its activity and outbox rows.
 */

export interface PolicyContext {
  readonly actor: ActorRef;
  readonly clock: Clock;
}

/**
 * PATCH semantics distinguish "omitted" from "explicitly cleared" (spec 20.4). A field
 * absent from the object is untouched; a field set to `null` is cleared.
 */
export type Patch<T> = T | null | undefined;

export interface CreateTaskInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskNumber: number;
  readonly title: string;
  readonly rank: string;
  readonly descriptionMd?: string | null;
  readonly priority?: Priority;
  readonly dueDate?: PlainDate | null;
  readonly dueTime?: PlainTime | null;
  readonly dueTimezone?: string | null;
  readonly parentTaskId?: string | null;
  /** Resolved destination. Omitted or null places the task in the Inbox (spec 9.1). */
  readonly project?: { readonly id: string; readonly status: WorkflowStatus } | null;
}

export function createTask(input: CreateTaskInput, context: PolicyContext): Task {
  const now = context.clock.now();

  if (input.project) {
    assertStatusBelongsToProject(input.project.id, input.project.status);
    if (isTerminal(input.project.status)) {
      throw new DomainError(
        "TASK_INVALID_STATUS",
        "A new task cannot be created directly in a Done status.",
        { statusId: input.project.status.id },
      );
    }
  }

  const task: Task = {
    id: input.id,
    workspaceId: input.workspaceId,
    taskNumber: input.taskNumber,
    projectId: input.project?.id ?? null,
    statusId: input.project?.status.id ?? null,
    title: normalizeTitle(input.title),
    descriptionMd: normalizeDescription(input.descriptionMd ?? null),
    priority: input.priority ?? "none",
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    dueTimezone: input.dueTime ? (input.dueTimezone ?? null) : null,
    parentTaskId: input.parentTaskId ?? null,
    rank: input.rank,
    lastActiveStatusId: null,
    completedAt: null,
    version: 1,
    createdBy: context.actor,
    lastActor: context.actor,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
  };

  assertTaskInvariants(task);
  return task;
}

export interface UpdateTaskFieldsInput {
  readonly title?: string;
  readonly descriptionMd?: Patch<string>;
  readonly priority?: Priority;
  readonly dueDate?: Patch<PlainDate>;
  readonly dueTime?: Patch<PlainTime>;
  readonly dueTimezone?: Patch<string>;
}

/**
 * Update the simple, non-structural fields. Project, status, rank, parent, and completion
 * each have their own command because they carry additional workflow consequences.
 */
export function updateTaskFields(
  task: Task,
  input: UpdateTaskFieldsInput,
  context: PolicyContext,
): Task {
  assertMutable(task);

  const dueDate = input.dueDate === undefined ? task.dueDate : input.dueDate;
  // Clearing the date must clear the time with it, or invariant 3 would be violated by a
  // request that only touched one of the two fields.
  const requestedTime = input.dueTime === undefined ? task.dueTime : input.dueTime;
  const dueTime = dueDate === null ? null : requestedTime;
  const requestedZone =
    input.dueTimezone === undefined ? task.dueTimezone : input.dueTimezone;

  const next: Task = {
    ...task,
    title: input.title === undefined ? task.title : normalizeTitle(input.title),
    descriptionMd:
      input.descriptionMd === undefined
        ? task.descriptionMd
        : normalizeDescription(input.descriptionMd),
    priority: input.priority ?? task.priority,
    dueDate,
    dueTime,
    dueTimezone: dueTime === null ? null : requestedZone,
  };

  return touch(next, task, context);
}

export interface MoveTaskInput {
  /** Destination project and status, or null to move the task back to the Inbox. */
  readonly destination: {
    readonly projectId: string;
    readonly status: WorkflowStatus;
  } | null;
  readonly rank: string;
}

/**
 * Move a task between the Inbox, projects, and workflow statuses (spec 11.5).
 *
 * Moving into a Done-category status completes the task; moving a completed task into a
 * non-Done category reopens it (spec 11.4).
 */
export function moveTask(
  task: Task,
  input: MoveTaskInput,
  context: PolicyContext,
): Task {
  assertMutable(task);

  if (input.destination === null) {
    // Back to the Inbox: project and status are cleared, completion is preserved.
    const next: Task = {
      ...task,
      projectId: null,
      statusId: null,
      lastActiveStatusId: null,
      rank: input.rank,
    };
    return touch(next, task, context);
  }

  const { projectId, status } = input.destination;
  assertStatusBelongsToProject(projectId, status);

  const enteringTerminal = isTerminal(status);
  const wasCompleted = isCompleted(task);

  const next: Task = {
    ...task,
    projectId,
    statusId: status.id,
    rank: input.rank,
    // Remember where the task came from so reopening is predictable (spec 8.5).
    lastActiveStatusId: enteringTerminal
      ? (task.statusId ?? task.lastActiveStatusId)
      : null,
    completedAt: enteringTerminal ? (task.completedAt ?? context.clock.now()) : null,
  };

  const result = touch(next, task, context);
  assertCompletionConsistency(result, status);

  // A no-op guard: re-entering the same terminal status must not restamp completion.
  if (enteringTerminal && wasCompleted && task.completedAt !== null) {
    return { ...result, completedAt: task.completedAt };
  }
  return result;
}

/** Rank-only change within the current scope (spec 20.3 `/tasks/{id}/reorder`). */
export function reorderTask(task: Task, rank: string, context: PolicyContext): Task {
  assertMutable(task);
  return touch({ ...task, rank }, task, context);
}

export interface CompleteTaskInput {
  /**
   * The project's terminal Done status, and the rank placing the task at the end of that
   * column. Omitted for an Inbox task, which keeps a null project and status (spec 8.5).
   */
  readonly doneStatus?: { readonly status: WorkflowStatus; readonly rank: string };
}

/**
 * Complete a task (spec 8.5).
 *
 * Project task: save the prior nonterminal status, move to Done at the end of the column,
 * stamp `completed_at`. Inbox task: keep null project and status and stamp `completed_at`.
 * Neither path removes tags, dates, relationships, or My Day history.
 */
export function completeTask(
  task: Task,
  input: CompleteTaskInput,
  context: PolicyContext,
): Task {
  assertMutable(task);
  if (isCompleted(task)) {
    // Completing an already-completed task is not a material change.
    return task;
  }

  if (task.projectId === null) {
    return touch({ ...task, completedAt: context.clock.now() }, task, context);
  }

  if (!input.doneStatus) {
    throw new DomainError(
      "STATUS_NOT_FOUND",
      "The project has no active Done status to complete into.",
      { taskId: task.id, projectId: task.projectId },
    );
  }

  const { status, rank } = input.doneStatus;
  assertStatusBelongsToProject(task.projectId, status);
  if (!isTerminal(status)) {
    throw new DomainError(
      "TASK_INVALID_STATUS",
      "Completion requires a Done-category status.",
      { taskId: task.id, statusId: status.id, category: status.category },
    );
  }

  const next: Task = {
    ...task,
    statusId: status.id,
    lastActiveStatusId: task.statusId,
    rank,
    completedAt: context.clock.now(),
  };

  const result = touch(next, task, context);
  assertCompletionConsistency(result, status);
  return result;
}

export interface ReopenTaskInput {
  /**
   * The status to reopen into, resolved by the application layer: the task's
   * `lastActiveStatusId` when it still exists and is nonterminal, otherwise the project's
   * default status (spec 8.5). Omitted for an Inbox task.
   */
  readonly destination?: { readonly status: WorkflowStatus; readonly rank: string };
}

export function reopenTask(
  task: Task,
  input: ReopenTaskInput,
  context: PolicyContext,
): Task {
  assertMutable(task);
  if (!isCompleted(task)) {
    return task;
  }

  if (task.projectId === null) {
    // An Inbox task returns to the Inbox with null project and status.
    return touch({ ...task, completedAt: null }, task, context);
  }

  if (!input.destination) {
    throw new DomainError(
      "STATUS_NOT_FOUND",
      "The project has no active status to reopen into.",
      { taskId: task.id, projectId: task.projectId },
    );
  }

  const { status, rank } = input.destination;
  assertStatusBelongsToProject(task.projectId, status);
  if (isTerminal(status)) {
    throw new DomainError(
      "TASK_INVALID_STATUS",
      "Reopening requires a status that is not Done.",
      { taskId: task.id, statusId: status.id },
    );
  }

  const next: Task = {
    ...task,
    statusId: status.id,
    lastActiveStatusId: null,
    rank,
    completedAt: null,
  };

  const result = touch(next, task, context);
  assertCompletionConsistency(result, status);
  return result;
}

/**
 * Resolve the status a completed task should reopen into (spec 8.5 steps 2–3): the last
 * active status when it is still active and nonterminal, otherwise the project's default.
 */
export function resolveReopenStatus(
  task: Task,
  statuses: readonly WorkflowStatus[],
): WorkflowStatus | null {
  const lastActive = statuses.find((status) => status.id === task.lastActiveStatusId);
  if (lastActive && isActive(lastActive) && !isTerminal(lastActive)) {
    return lastActive;
  }
  return (
    statuses.find(
      (status) => status.isDefault && isActive(status) && !isTerminal(status),
    ) ?? null
  );
}

export interface SetParentInput {
  /** The new parent, or null to detach the task from its current parent. */
  readonly parent: Task | null;
  /** Ancestor chain of the new parent, nearest first; irrelevant when detaching. */
  readonly ancestorIds?: readonly string[];
  /** Levels already hanging below this task: 0 when it has no children. */
  readonly descendantDepth?: number;
}

/**
 * Attach a task to a parent or detach it (spec 8.3). A subtask stays a normal task: its
 * project, status, rank, and completion are untouched, so every existing view keeps
 * working on it. The parent must be a live task of the same workspace, the chain must
 * stay acyclic, and the resulting tree may not exceed `MAX_NESTING_DEPTH`.
 */
export function setParent(
  task: Task,
  input: SetParentInput,
  context: PolicyContext,
): Task {
  assertMutable(task);

  if (input.parent === null) {
    return touch({ ...task, parentTaskId: null }, task, context);
  }

  const parent = input.parent;
  if (parent.workspaceId !== task.workspaceId || isDeleted(parent)) {
    throw new DomainError("TASK_NOT_FOUND", "Parent task not found.", {
      taskId: task.id,
      parentTaskId: parent.id,
    });
  }
  assertParentIsAssignable(
    task.id,
    parent.id,
    input.ancestorIds ?? [],
    input.descendantDepth ?? 0,
  );

  return touch({ ...task, parentTaskId: parent.id }, task, context);
}

export interface ChildProgress {
  readonly completed: number;
  readonly total: number;
}

/**
 * Parent progress is completed direct children over total direct children (spec 8.3).
 * Deleted children are excluded: they are out of every normal view until restored.
 */
export function childProgress(children: readonly Task[]): ChildProgress {
  const live = children.filter((child) => !isDeleted(child));
  return {
    completed: live.filter(isCompleted).length,
    total: live.length,
  };
}

/** Soft deletion moves the task to Trash and keeps it restorable (spec 8.6). */
export function deleteTask(task: Task, context: PolicyContext): Task {
  if (isDeleted(task)) return task;
  const now = context.clock.now();
  return touch({ ...task, deletedAt: now, deletedBy: context.actor }, task, context);
}

export function restoreTask(task: Task, context: PolicyContext): Task {
  if (!isDeleted(task)) return task;
  return touch({ ...task, deletedAt: null, deletedBy: null }, task, context);
}

/**
 * Optimistic concurrency guard (spec 8.2 invariant 12, 24.2). `expectedVersion` is
 * optional; when supplied it must match exactly, and a mismatch changes nothing.
 */
export function assertExpectedVersion(
  task: Task,
  expectedVersion: number | undefined,
): void {
  if (expectedVersion === undefined) return;
  if (expectedVersion !== task.version) {
    throw new VersionConflictError(task.id, expectedVersion, task.version);
  }
}

function assertMutable(task: Task): void {
  if (isDeleted(task)) {
    throw new ValidationError("A deleted task must be restored before it can change.", {
      taskId: task.id,
    });
  }
}

/**
 * Stamp the audit fields of a material mutation: bump the version, record the acting
 * party, and refresh `updated_at` (spec 8.2 invariants 11–12). When nothing actually
 * changed the original task is returned so no spurious version or activity is produced.
 */
function touch(next: Task, previous: Task, context: PolicyContext): Task {
  if (!hasMaterialChange(next, previous)) {
    return previous;
  }
  const result: Task = {
    ...next,
    version: previous.version + 1,
    lastActor: context.actor,
    updatedAt: context.clock.now(),
  };
  assertTaskInvariants(result);
  return result;
}

const MATERIAL_FIELDS = [
  "projectId",
  "statusId",
  "title",
  "descriptionMd",
  "priority",
  "dueDate",
  "dueTime",
  "dueTimezone",
  "parentTaskId",
  "rank",
  "lastActiveStatusId",
  "completedAt",
  "deletedAt",
] as const satisfies readonly (keyof Task)[];

function hasMaterialChange(next: Task, previous: Task): boolean {
  return MATERIAL_FIELDS.some((field) => {
    const a = next[field];
    const b = previous[field];
    if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
    return a !== b;
  });
}

/** The fields that changed, for the activity payload and event diff (spec 18.2). */
export function materialChanges(
  next: Task,
  previous: Task,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of MATERIAL_FIELDS) {
    const a = next[field];
    const b = previous[field];
    const changed =
      a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    if (changed) {
      changes[field] = {
        from: b instanceof Date ? b.toISOString() : b,
        to: a instanceof Date ? a.toISOString() : a,
      };
    }
  }
  return changes;
}
