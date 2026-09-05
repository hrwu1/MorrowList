import { z } from "zod";

import { prioritySchema, uuidSchema } from "./common.js";
import { MAX_FIELD_FILTERS, fieldFilterSchema } from "./field.js";
import { deadlineFilterSchema, dueFilterSchema } from "./task.js";

/**
 * Personal saved views (spec 9.8, 18.4, GAP-02): a named filter set rendered as a list
 * or a board. Views are personal by design; the owner is the session user and no field
 * shares one.
 */

export const savedViewLayoutSchema = z.enum(["list", "board"]);

/**
 * The stored filter set is the task list query without paging, so a saved view is
 * exactly what `GET /tasks` takes back. Every field is optional; an empty object is
 * "all open tasks".
 */
export const savedViewFiltersSchema = z
  .object({
    projectId: uuidSchema.optional(),
    statusId: uuidSchema.optional(),
    priority: prioritySchema.optional(),
    tagId: uuidSchema.optional(),
    isCompleted: z.boolean().optional(),
    isBlocked: z.boolean().optional(),
    due: dueFilterSchema.optional(),
    deferred: z.boolean().optional(),
    deadline: deadlineFilterSchema.optional(),
    /** Typed custom-field filters, exactly as the list query carries them (GAP-24). */
    fields: z.array(fieldFilterSchema).max(MAX_FIELD_FILTERS).optional(),
    inbox: z.boolean().optional(),
    sort: z.enum(["rank", "createdAt", "dueDate", "priority", "updatedAt"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export const savedViewSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  ownerUserId: uuidSchema,
  name: z.string(),
  filters: savedViewFiltersSchema,
  layout: savedViewLayoutSchema,
  rank: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const savedViewNameSchema = z.string().trim().min(1).max(100);

export const createSavedViewRequestSchema = z.object({
  name: savedViewNameSchema,
  filters: savedViewFiltersSchema.default({}),
  layout: savedViewLayoutSchema.default("list"),
});

export const updateSavedViewRequestSchema = z
  .object({
    name: savedViewNameSchema.optional(),
    filters: savedViewFiltersSchema.optional(),
    layout: savedViewLayoutSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

/** Neighbours describe the intended position; the server computes the rank (spec 24.2). */
export const reorderSavedViewRequestSchema = z
  .object({
    beforeViewId: uuidSchema.nullish(),
    afterViewId: uuidSchema.nullish(),
  })
  .refine(
    (body) =>
      body.beforeViewId == null ||
      body.afterViewId == null ||
      body.beforeViewId !== body.afterViewId,
    {
      message: "beforeViewId and afterViewId must be different views",
      path: ["afterViewId"],
    },
  );

export const savedViewResponseSchema = z.object({ data: savedViewSchema });
export const savedViewListResponseSchema = z.object({ data: z.array(savedViewSchema) });

export type SavedViewLayout = z.infer<typeof savedViewLayoutSchema>;
export type SavedViewFilters = z.infer<typeof savedViewFiltersSchema>;
export type SavedViewDto = z.infer<typeof savedViewSchema>;
export type CreateSavedViewRequest = z.infer<typeof createSavedViewRequestSchema>;
export type UpdateSavedViewRequest = z.infer<typeof updateSavedViewRequestSchema>;
export type ReorderSavedViewRequest = z.infer<typeof reorderSavedViewRequestSchema>;
export type SavedViewListResponse = z.infer<typeof savedViewListResponseSchema>;
