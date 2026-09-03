import { z } from "zod";

import { uuidSchema } from "./common.js";

/** Tag transport schemas (spec 12.1, 20.3). */

/** Mirrors `TAG_COLOR_TOKENS` in `@morrowlist/domain`; contracts is a leaf package. */
export const tagColorTokenSchema = z.enum([
  "neutral",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
]);

export const tagSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  colorToken: tagColorTokenSchema,
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A tag as listed for management, with how many live tasks carry it. */
export const tagListItemSchema = tagSchema.extend({
  taskCount: z.number().int().nonnegative(),
});

export const tagNameSchema = z.string().trim().min(1).max(80);

export const createTagRequestSchema = z.object({
  name: tagNameSchema,
  colorToken: tagColorTokenSchema.optional(),
  description: z.string().max(500).nullish(),
});

/** PATCH semantics as for tasks: omitted is untouched, null clears (spec 20.4). */
export const updateTagRequestSchema = z
  .object({
    name: tagNameSchema.optional(),
    colorToken: tagColorTokenSchema.optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const tagResponseSchema = z.object({ data: tagSchema });
export const tagListResponseSchema = z.object({ data: z.array(tagListItemSchema) });

export type TagColorToken = z.infer<typeof tagColorTokenSchema>;
export type TagDto = z.infer<typeof tagSchema>;
export type TagListItemDto = z.infer<typeof tagListItemSchema>;
export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;
export type TagListResponse = z.infer<typeof tagListResponseSchema>;
