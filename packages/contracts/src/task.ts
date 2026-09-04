import { z } from "zod";

import {
  actorSchema,
  paginated,
  paginationQuerySchema,
  plainDateSchema,
  plainTimeSchema,
  prioritySchema,
  timezoneSchema,
  uuidSchema,
} from "./common.js";
import { tagSchema } from "./tag.js";

/** Task transport schemas (spec 20.3–20.5). */

/** Mirrors the constants in `@morrowlist/domain`'s recurrence module; contracts is a leaf. */
export const recurrenceFrequencySchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
export const recurrenceModeSchema = z.enum(["schedule", "after_completion"]);
export const weekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const nthWeekSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(-1),
]);

/**
 * A recurrence rule (GAP-12). The transport accepts the parts a frequency needs and fills
 * the rest with null; the domain validates the combination (a weekly rule needs
 * weekdays, a monthly rule exactly one of `monthDay` and `nthWeekday`) and canonicalises
 * it, so a task always reports the same shape it was given.
 */
export const recurrenceRuleSchema = z.object({
  freq: recurrenceFrequencySchema,
  interval: z.number().int().min(1).max(365).default(1),
  mode: recurrenceModeSchema.default("schedule"),
  weekdays: z.array(weekdaySchema).min(1).max(7).nullable().default(null),
  monthDay: z.number().int().min(1).max(31).nullable().default(null),
  nthWeekday: z
    .object({ nth: nthWeekSchema, weekday: weekdaySchema })
    .nullable()
    .default(null),
  until: plainDateSchema.nullable().default(null),
  count: z.number().int().min(1).max(1000).nullable().default(null),
});

/** Completed over total direct children (spec 8.3); null when a task has no children. */
export const subtaskProgressSchema = z.object({
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

/** MVP relationship types (spec 8.4); `duplicates` and friends are reserved. */
export const relationTypeSchema = z.enum(["blocks", "related_to"]);

/** The other endpoint of a relation, enough to render a link and its open state. */
export const relatedTaskSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  title: z.string(),
  isCompleted: z.boolean(),
});

/**
 * One relation as seen from a task. `blocks` reads source → target; `related_to` is
 * symmetric. `task` is always the other endpoint, whichever side this task is on.
 */
export const taskRelationSchema = z.object({
  id: uuidSchema,
  type: relationTypeSchema,
  sourceTaskId: uuidSchema,
  targetTaskId: uuidSchema,
  task: relatedTaskSchema,
  createdAt: z.iso.datetime(),
});

/** The explicit blocker flag: why the task cannot move, and since when (spec 8.4). */
export const taskBlockedSchema = z.object({
  reason: z.string(),
  since: z.iso.datetime(),
});

export const dateWarningSchema = z.enum([
  "defer_after_due",
  "due_after_deadline",
  "defer_after_deadline",
]);

export const taskSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  workspaceId: uuidSchema,
  taskNumber: z.number().int().positive(),
  projectId: uuidSchema.nullable(),
  statusId: uuidSchema.nullable(),
  title: z.string(),
  descriptionMd: z.string().nullable(),
  priority: prioritySchema,
  dueDate: plainDateSchema.nullable(),
  dueTime: plainTimeSchema.nullable(),
  dueTimezone: timezoneSchema.nullable(),
  /** Hidden from Today, Upcoming, the Inbox and the board until this day (GAP-16). */
  deferUntil: plainDateSchema.nullable(),
  /** The hard limit, distinct from the planned `dueDate` (GAP-16). */
  deadline: plainDateSchema.nullable(),
  /** Wall-clock time of the deadline in the workspace timezone; requires `deadline`. */
  deadlineTime: plainTimeSchema.nullable(),
  /**
   * The expected order is deferUntil ≤ dueDate ≤ deadline. Breaking it is allowed; these
   * codes say which pair is out of order so a client can warn (GAP-16).
   */
  dateWarnings: z.array(dateWarningSchema),
  parentTaskId: uuidSchema.nullable(),
  recurrence: recurrenceRuleSchema.nullable(),
  /** Shared by every occurrence of a repeating task; the first occurrence's id. */
  seriesId: uuidSchema.nullable(),
  rank: z.string(),
  isCompleted: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  /** Ordered by normalized name, so the same task always lists its tags the same way. */
  tags: z.array(tagSchema),
  createdBy: actorSchema,
  lastActor: actorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  /**
   * My Day selections on or after the workspace's current date, ascending (spec 9.2,
   * 9.5). Today's selection, when present, is the first entry, so a card can show the
   * My Day indicator without knowing the workspace timezone.
   */
  dayPlans: z.array(plainDateSchema),
  subtaskProgress: subtaskProgressSchema.nullable(),
  /** Relations to tasks outside the Trash, oldest first. */
  relations: z.array(taskRelationSchema),
  blocked: taskBlockedSchema.nullable(),
  /** Open and either flagged or waiting on an incomplete `blocks` predecessor. */
  isBlocked: z.boolean(),
  /**
   * Flow fields (GAP-17), present on board cards only. `inStatusSince` is when the task
   * entered its current status; `ageDays` is its work item age — time since it was
   * started — and is null while it is queued or done.
   */
  inStatusSince: z.iso.datetime().nullable().optional(),
  ageDays: z.number().nonnegative().nullable().optional(),
});

export const titleSchema = z.string().trim().min(1).max(500);

/**
 * Only `title` is required (spec 20.4). `projectId` and `statusId` left null place the
 * task in the Inbox.
 */
export const createTaskRequestSchema = z
  .object({
    title: titleSchema,
    descriptionMd: z.string().max(50_000).nullish(),
    projectId: uuidSchema.nullish(),
    statusId: uuidSchema.nullish(),
    priority: prioritySchema.optional(),
    dueDate: plainDateSchema.nullish(),
    dueTime: plainTimeSchema.nullish(),
    dueTimezone: timezoneSchema.nullish(),
    deferUntil: plainDateSchema.nullish(),
    deadline: plainDateSchema.nullish(),
    deadlineTime: plainTimeSchema.nullish(),
    parentTaskId: uuidSchema.nullish(),
    recurrence: recurrenceRuleSchema.nullish(),
    /** Add the new task to a My Day date in the same command (spec 20.4). */
    addToDay: plainDateSchema.nullish(),
  })
  .refine((body) => !(body.dueTime && !body.dueDate), {
    message: "dueTime requires dueDate",
    path: ["dueTime"],
  })
  .refine((body) => !(body.deadlineTime && !body.deadline), {
    message: "deadlineTime requires deadline",
    path: ["deadlineTime"],
  })
  .refine((body) => !(body.statusId && !body.projectId), {
    message: "statusId requires projectId",
    path: ["statusId"],
  });

/**
 * PATCH must distinguish an omitted field from one explicitly set to null (spec 20.4).
 * Zod preserves that difference: a key absent from the parsed object was omitted, and an
 * explicit `null` is a clear.
 */
export const updateTaskRequestSchema = z
  .object({
    title: titleSchema.optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    priority: prioritySchema.optional(),
    dueDate: plainDateSchema.nullable().optional(),
    dueTime: plainTimeSchema.nullable().optional(),
    dueTimezone: timezoneSchema.nullable().optional(),
    /** A rule applies to this and future occurrences; null stops the series here. */
    recurrence: recurrenceRuleSchema.nullable().optional(),
    deferUntil: plainDateSchema.nullable().optional(),
    deadline: plainDateSchema.nullable().optional(),
    deadlineTime: plainTimeSchema.nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), {
    message: "at least one field must be supplied",
  });

export const moveTaskRequestSchema = z
  .object({
    /** Null moves the task back to the Inbox (spec 11.5). */
    projectId: uuidSchema.nullable(),
    statusId: uuidSchema.nullish(),
    /** Neighbours describe the intended position; the server computes the rank (spec 24.2). */
    beforeTaskId: uuidSchema.nullish(),
    afterTaskId: uuidSchema.nullish(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .superRefine((body, context) => {
    if (body.projectId === null && body.statusId != null) {
      context.addIssue({
        code: "custom",
        message: "statusId requires a project destination",
        path: ["statusId"],
      });
    }
    if (
      body.beforeTaskId != null &&
      body.afterTaskId != null &&
      body.beforeTaskId === body.afterTaskId
    ) {
      context.addIssue({
        code: "custom",
        message: "beforeTaskId and afterTaskId must be different tasks",
        path: ["afterTaskId"],
      });
    }
  });

export const reorderTaskRequestSchema = z
  .object({
    beforeTaskId: uuidSchema.nullish(),
    afterTaskId: uuidSchema.nullish(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine(
    (body) =>
      body.beforeTaskId == null ||
      body.afterTaskId == null ||
      body.beforeTaskId !== body.afterTaskId,
    {
      message: "beforeTaskId and afterTaskId must be different tasks",
      path: ["afterTaskId"],
    },
  );

export const completeTaskRequestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  /**
   * A blocked task completes only after an explicit warning (spec 8.4); without this the
   * command answers TASK_BLOCKED and changes nothing.
   */
  acknowledgeBlocked: z.boolean().optional(),
});

export const reopenTaskRequestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

/** `POST /tasks/{id}/relations`: `{id}` is the source of a `blocks` relation. */
export const addTaskRelationRequestSchema = z.object({
  type: relationTypeSchema,
  targetTaskId: uuidSchema,
});

export const BLOCKED_REASON_MAX_LENGTH = 500;

/** `POST /tasks/{id}/blocked`; clearing is `DELETE /tasks/{id}/blocked`. */
export const setTaskBlockedRequestSchema = z.object({
  reason: z.string().trim().min(1).max(BLOCKED_REASON_MAX_LENGTH),
  expectedVersion: z.number().int().positive().optional(),
});

/** `POST /tasks/{id}/skip`: move a repeating task on to its next occurrence (GAP-12). */
export const skipOccurrenceRequestSchema = reopenTaskRequestSchema;

/** `POST /tasks/{id}/today`: the date defaults to the workspace's current date. */
export const addTaskToDayRequestSchema = z.object({
  date: plainDateSchema.optional(),
});

/** Attach a task to a parent (spec 8.3). Detaching is `DELETE /tasks/{id}/parent`. */
export const setTaskParentRequestSchema = z.object({
  parentTaskId: uuidSchema,
  expectedVersion: z.number().int().positive().optional(),
});

export const dueFilterSchema = z.enum(["overdue", "today", "future", "none"]);
export const deadlineFilterSchema = z.enum(["overdue", "week", "none"]);

/** Task list query fields (spec 20.5). */
export const listTasksQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  statusId: uuidSchema.optional(),
  priority: prioritySchema.optional(),
  tagId: uuidSchema.optional(),
  parentTaskId: uuidSchema.optional(),
  /** Every occurrence of one repeating task, completed ones included (GAP-12). */
  seriesId: uuidSchema.optional(),
  isCompleted: z.stringbool().optional(),
  isBlocked: z.stringbool().optional(),
  due: dueFilterSchema.optional(),
  /**
   * Deferral is judged against the workspace's current date (GAP-16): `true` selects
   * tasks whose defer date is still ahead, `false` excludes them, omitted lists both.
   */
  deferred: z.stringbool().optional(),
  /** `week` is a deadline from today through the next seven days inclusive. */
  deadline: deadlineFilterSchema.optional(),
  includeSubtasks: z.stringbool().default(true),
  /** Inbox tasks only: no project (spec 9.1). */
  inbox: z.stringbool().optional(),
  /**
   * Trash (spec 9.7). Soft-deleted tasks are excluded from every other view (spec 8.2
   * invariant 10), so this selects them instead of widening a normal list: `true` returns
   * only deleted tasks.
   */
  deleted: z.stringbool().optional(),
  sort: z
    .enum(["rank", "createdAt", "dueDate", "priority", "updatedAt"])
    .default("rank"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export const taskResponseSchema = z.object({ data: taskSchema });

/**
 * The workspace's cross-project "in progress" limit was exceeded by this command
 * (GAP-20). A warning, never an error: the command succeeded, and the tasks listed are
 * everything currently started so the user can decide what to put back.
 */
export const wipWarningSchema = z.object({
  code: z.literal("IN_PROGRESS_LIMIT_EXCEEDED"),
  limit: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  message: z.string(),
  tasks: z.array(
    z.object({
      id: uuidSchema,
      key: z.string(),
      title: z.string(),
      projectId: uuidSchema.nullable(),
    }),
  ),
});

/** Commands that can start work answer with the task and any limit warnings. */
export const taskCommandResponseSchema = z.object({
  data: taskSchema,
  warnings: z.array(wipWarningSchema),
});
export const taskListResponseSchema = paginated(taskSchema);

export type TaskDto = z.infer<typeof taskSchema>;
export type WipWarningDto = z.infer<typeof wipWarningSchema>;
export type TaskCommandResponse = z.infer<typeof taskCommandResponseSchema>;
/** The unwrapped form of `TaskCommandResponse`: the task with its limit warnings. */
export interface TaskCommandResult {
  readonly task: TaskDto;
  readonly warnings: readonly WipWarningDto[];
}
export type RecurrenceRuleDto = z.infer<typeof recurrenceRuleSchema>;
export type RecurrenceRuleRequest = z.input<typeof recurrenceRuleSchema>;
export type DateWarning = z.infer<typeof dateWarningSchema>;
export type DeadlineFilter = z.infer<typeof deadlineFilterSchema>;
export type SubtaskProgress = z.infer<typeof subtaskProgressSchema>;
export type RelationType = z.infer<typeof relationTypeSchema>;
export type RelatedTaskDto = z.infer<typeof relatedTaskSchema>;
export type TaskRelationDto = z.infer<typeof taskRelationSchema>;
export type TaskBlockedDto = z.infer<typeof taskBlockedSchema>;
export type AddTaskRelationRequest = z.infer<typeof addTaskRelationRequestSchema>;
export type SetTaskBlockedRequest = z.infer<typeof setTaskBlockedRequestSchema>;
export type ReopenTaskRequest = z.infer<typeof reopenTaskRequestSchema>;
export type SetTaskParentRequest = z.infer<typeof setTaskParentRequestSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;
export type ReorderTaskRequest = z.infer<typeof reorderTaskRequestSchema>;
export type CompleteTaskRequest = z.infer<typeof completeTaskRequestSchema>;
export type AddTaskToDayRequest = z.infer<typeof addTaskToDayRequestSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
