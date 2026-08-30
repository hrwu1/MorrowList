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

/** Task transport schemas (spec 20.3–20.5). */

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
  createdBy: actorSchema,
  lastActor: actorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
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
});

export const reopenTaskRequestSchema = completeTaskRequestSchema;

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
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;
export type ReorderTaskRequest = z.infer<typeof reorderTaskRequestSchema>;
export type CompleteTaskRequest = z.infer<typeof completeTaskRequestSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
