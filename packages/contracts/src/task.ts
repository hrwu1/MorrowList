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
  parentTaskId: uuidSchema.nullable(),
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
    parentTaskId: uuidSchema.nullish(),
    /** Add the new task to a My Day date in the same command (spec 20.4). */
    addToDay: plainDateSchema.nullish(),
  })
  .refine((body) => !(body.dueTime && !body.dueDate), {
    message: "dueTime requires dueDate",
    path: ["dueTime"],
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

/** Task list query fields (spec 20.5). */
export const listTasksQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  statusId: uuidSchema.optional(),
  priority: prioritySchema.optional(),
  tagId: uuidSchema.optional(),
  parentTaskId: uuidSchema.optional(),
  isCompleted: z.stringbool().optional(),
  isBlocked: z.stringbool().optional(),
  due: dueFilterSchema.optional(),
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
export const taskListResponseSchema = paginated(taskSchema);

export type TaskDto = z.infer<typeof taskSchema>;
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
