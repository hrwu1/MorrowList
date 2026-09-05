import { isActive, isTerminal, type WorkflowStatus } from "../project/status.js";
import type { ActorRef } from "../shared/actor.js";
import type { Clock } from "../shared/clock.js";
import {
  DomainError,
  ValidationError,
  VersionConflictError,
} from "../shared/errors.js";

import {
  applyFields,
  sameFieldValues,
  type FieldDefinition,
  type FieldValuePatch,
  type FieldValues,
} from "./fields.js";
import {
  assertCompletionConsistency,
  assertParentIsAssignable,
  assertStatusBelongsToProject,
  assertTaskInvariants,
} from "./invariants.js";
import {
  nextOccurrenceAfter,
  sameRecurrence,
  toRecurrenceRule,
  type RecurrenceRule,
  type RecurrenceRuleInput,
} from "./recurrence.js";
import { normalizeBlockedReason } from "./relation.js";
import { isCompleted, isDeleted, type Task } from "./task.js";
import {
  DEFAULT_REMINDER_OFFSET_MINUTES,
  addDays,
  daysBetween,
  normalizeDescription,
  normalizeTitle,
  toReminderOffset,
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
  readonly deferUntil?: PlainDate | null;
  readonly deadline?: PlainDate | null;
  readonly deadlineTime?: PlainTime | null;
  /**
   * Omitted applies `defaultReminderOffsetMinutes` when there is a due time; null means
   * no reminder (GAP-13).
   */
  readonly reminderOffsetMinutes?: number | null;
  readonly defaultReminderOffsetMinutes?: number;
  readonly parentTaskId?: string | null;
  /** Typed custom-field values, already validated against their definitions (GAP-24). */
  readonly fields?: FieldValues;
  readonly recurrence?: RecurrenceRuleInput | null;
  /** The series this task continues; a new repeating task starts its own. */
  readonly seriesId?: string | null;
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
    deferUntil: input.deferUntil ?? null,
    deadline: input.deadline ?? null,
    deadlineTime: input.deadlineTime ?? null,
    reminderOffsetMinutes: resolveReminderOffset(
      input.dueTime ?? null,
      null,
      input.reminderOffsetMinutes,
      input.defaultReminderOffsetMinutes,
    ),
    fields: input.fields ?? {},
    parentTaskId: input.parentTaskId ?? null,
    recurrence: input.recurrence ? toRecurrenceRule(input.recurrence) : null,
    seriesId: input.seriesId ?? (input.recurrence ? input.id : null),
    rank: input.rank,
    lastActiveStatusId: null,
    completedAt: null,
    blockedReason: null,
    blockedSince: null,
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
  /** Setting a rule on a task that never repeated starts a series with this task. */
  readonly recurrence?: Patch<RecurrenceRuleInput>;
  readonly deferUntil?: Patch<PlainDate>;
  readonly deadline?: Patch<PlainDate>;
  readonly deadlineTime?: Patch<PlainTime>;
  /** Omitted keeps the current offset, or applies the default when a due time first appears. */
  readonly reminderOffsetMinutes?: Patch<number>;
  readonly defaultReminderOffsetMinutes?: number;
  /**
   * Typed custom-field values (GAP-24): an omitted key is untouched, `null` clears one.
   * The workspace's definitions come with it so the values are validated here rather
   * than at the transport boundary, which cannot know what a workspace defined.
   */
  readonly fields?: FieldValuePatch;
  readonly fieldDefinitions?: readonly FieldDefinition[];
}

/**
 * The reminder offset a task ends up with (GAP-13): none without a due time; an explicit
 * value when the caller gave one; otherwise the current one, or the default the first
 * time a due time is set so a timed task reminds by default.
 */
function resolveReminderOffset(
  dueTime: PlainTime | null,
  current: number | null,
  requested: Patch<number>,
  fallback: number | undefined,
): number | null {
  if (dueTime === null) return null;
  if (requested !== undefined) {
    return requested === null ? null : toReminderOffset(requested);
  }
  return current ?? fallback ?? DEFAULT_REMINDER_OFFSET_MINUTES;
}

/**
 * Update the simple, non-structural fields. Project, status, rank, parent, and completion
 * each have their own command because they carry additional workflow consequences.
 *
 * The three dates are not checked against each other here: `dateOrderWarnings` reports
 * an unusual order so a client can warn, but the change is always accepted (GAP-16).
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
  const recurrence =
    input.recurrence === undefined
      ? task.recurrence
      : input.recurrence === null
        ? null
        : toRecurrenceRule(input.recurrence);

  // The deadline and its time follow the same rule.
  const deadline = input.deadline === undefined ? task.deadline : input.deadline;
  const requestedDeadlineTime =
    input.deadlineTime === undefined ? task.deadlineTime : input.deadlineTime;

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
    recurrence,
    // Clearing a rule keeps the series link, so the history of a stopped series stays.
    seriesId: task.seriesId ?? (recurrence ? task.id : null),
    deferUntil: input.deferUntil === undefined ? task.deferUntil : input.deferUntil,
    deadline,
    deadlineTime: deadline === null ? null : requestedDeadlineTime,
    reminderOffsetMinutes: resolveReminderOffset(
      dueTime,
      // A due time set for the first time takes the default, not a stale offset.
      task.dueTime === null ? null : task.reminderOffsetMinutes,
      input.reminderOffsetMinutes,
      input.defaultReminderOffsetMinutes,
    ),
    fields:
      input.fields === undefined
        ? task.fields
        : applyFields(task.fields, input.fields, input.fieldDefinitions ?? []),
  };

  return touch(next, task, context);
}

/**
 * The next occurrence of a repeating task as a new-task description, or null when the
 * task does not repeat or the series ends here. The application layer allocates the id
 * and number, resolves the project's default status, and copies the tags.
 */
/**
 * The defer date and deadline are a window around the due date (GAP-16): "defer until
 * three days before, deadline two days after". When an occurrence moves to its next due
 * date, the window moves with it by the same number of days. Without a due date there is
 * no window to move, so the result is null and the caller decides what that means.
 */
function shiftedDateWindow(
  task: Task,
  dueDate: PlainDate,
): Pick<Task, "deferUntil" | "deadline" | "deadlineTime"> | null {
  if (task.dueDate === null) return null;
  const days = daysBetween(task.dueDate, dueDate);
  return {
    deferUntil: task.deferUntil === null ? null : addDays(task.deferUntil, days),
    deadline: task.deadline === null ? null : addDays(task.deadline, days),
    deadlineTime: task.deadline === null ? null : task.deadlineTime,
  };
}

export function spawnNextOccurrence(
  task: Task,
  completedOn: PlainDate,
):
  | (Omit<CreateTaskInput, "id" | "taskNumber" | "rank" | "project"> & {
      readonly projectId: string | null;
      readonly dueDate: PlainDate;
      readonly recurrence: RecurrenceRule;
      readonly seriesId: string;
    })
  | null {
  const next = nextOccurrenceAfter(task, completedOn);
  if (!next) return null;
  // A new occurrence starts without the dates when nothing anchors them.
  const window = shiftedDateWindow(task, next.dueDate) ?? {
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
  };
  return {
    workspaceId: task.workspaceId,
    title: task.title,
    descriptionMd: task.descriptionMd,
    priority: task.priority,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    // The next occurrence starts where this one did, custom values included.
    fields: task.fields,
    dueDate: next.dueDate,
    dueTime: task.dueTime,
    dueTimezone: task.dueTimezone,
    ...window,
    // The next occurrence reminds the way this one did (GAP-13).
    reminderOffsetMinutes: task.reminderOffsetMinutes,
    recurrence: next.recurrence,
    seriesId: task.seriesId ?? task.id,
  };
}

/**
 * Skip the current occurrence: the same task moves on to its next date and the rule's
 * count advances, exactly as completion would have spawned it — but nothing is created.
 * The last occurrence has nothing to skip to, so it is rejected rather than silently
 * ended; completing or deleting it is the explicit way out.
 */
export function skipOccurrence(
  task: Task,
  on: PlainDate,
  context: PolicyContext,
): Task {
  assertMutable(task);
  if (task.recurrence === null) {
    throw new ValidationError("This task does not repeat.", { taskId: task.id });
  }
  if (isCompleted(task)) {
    throw new ValidationError("A completed occurrence cannot be skipped.", {
      taskId: task.id,
    });
  }
  const next = nextOccurrenceAfter(task, on);
  if (!next) {
    throw new ValidationError(
      "This is the last occurrence of its series; there is nothing to skip to.",
      { taskId: task.id },
    );
  }
  // The same task keeps its own dates when it had no due date to move them with.
  return touch(
    {
      ...task,
      ...(shiftedDateWindow(task, next.dueDate) ?? {}),
      dueDate: next.dueDate,
      recurrence: next.recurrence,
    },
    task,
    context,
  );
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
  return relocateTask(task, input, context);
}

/**
 * The move policy without the Trash guard. Only the archive of a workflow status uses it
 * directly: a trashed task in an archived column has to travel with the column's other
 * tasks, or restoring it later would place it in a column that no longer exists.
 */
export function relocateTask(
  task: Task,
  input: MoveTaskInput,
  context: PolicyContext,
): Task {
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

/**
 * Flag a task as blocked with a reason (spec 8.4, GAP-06). The task stays in its
 * workflow status: the flag is the signal, the column is only a view (spec 9.5). Changing
 * the reason keeps the original start so blocked time is measured from the first flag.
 */
export function flagBlocked(task: Task, reason: string, context: PolicyContext): Task {
  assertMutable(task);
  const normalized = normalizeBlockedReason(reason);
  return touch(
    {
      ...task,
      blockedReason: normalized,
      blockedSince: task.blockedSince ?? context.clock.now(),
    },
    task,
    context,
  );
}

/** Clear the blocker flag; a no-op when the task is not flagged. */
export function clearBlocked(task: Task, context: PolicyContext): Task {
  assertMutable(task);
  return touch({ ...task, blockedReason: null, blockedSince: null }, task, context);
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
  "deferUntil",
  "deadline",
  "deadlineTime",
  "reminderOffsetMinutes",
  "parentTaskId",
  "recurrence",
  "seriesId",
  "fields",
  "rank",
  "lastActiveStatusId",
  "completedAt",
  "blockedReason",
  "blockedSince",
  "deletedAt",
] as const satisfies readonly (keyof Task)[];

function fieldChanged(
  field: (typeof MATERIAL_FIELDS)[number],
  next: Task,
  previous: Task,
) {
  if (field === "recurrence")
    return !sameRecurrence(next.recurrence, previous.recurrence);
  if (field === "fields") return !sameFieldValues(next.fields, previous.fields);
  const a = next[field];
  const b = previous[field];
  if (a instanceof Date && b instanceof Date) return a.getTime() !== b.getTime();
  return a !== b;
}

function hasMaterialChange(next: Task, previous: Task): boolean {
  return MATERIAL_FIELDS.some((field) => fieldChanged(field, next, previous));
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
    if (fieldChanged(field, next, previous)) {
      changes[field] = {
        from: b instanceof Date ? b.toISOString() : b,
        to: a instanceof Date ? a.toISOString() : a,
      };
    }
  }
  return changes;
}
