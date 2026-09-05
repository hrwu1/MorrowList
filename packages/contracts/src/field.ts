import { z } from "zod";

import { uuidSchema } from "./common.js";

/**
 * Typed custom field transport schemas (GAP-24, spec 20.3).
 *
 * A workspace defines at most ten fields of four types; a task carries their values in a
 * single map keyed by the definition's `key`. Mirrors the constants in
 * `@morrowlist/domain`'s field module, because contracts is a leaf package.
 */

export const MAX_FIELDS_PER_WORKSPACE = 10;
export const MAX_SELECT_OPTIONS = 20;
export const MAX_FIELD_FILTERS = 4;

export const fieldTypeSchema = z.enum(["select", "number", "date", "text"]);

export const fieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_ -]*$/, "a field key is a short identifier");

export const fieldNameSchema = z.string().trim().min(1).max(80);

export const fieldDefinitionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  /** Stable identifier used in values, filters, the CLI and export. */
  key: z.string(),
  name: z.string(),
  type: fieldTypeSchema,
  /** The allowed values of a select; empty for every other type. */
  options: z.array(z.string()),
  rank: z.string(),
  /** Render the value on board cards and list rows (at most two fields are shown). */
  showOnCard: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A definition as listed for management, with how many live tasks carry a value. */
export const fieldDefinitionListItemSchema = fieldDefinitionSchema.extend({
  taskCount: z.number().int().nonnegative(),
});

/** A number is a JSON number; select, date and text are strings. */
export const fieldValueSchema = z.union([z.string(), z.number()]);

/** A task's values. Validation against the definitions happens in the domain. */
export const fieldValuesSchema = z.record(z.string(), fieldValueSchema);

/** PATCH semantics: an omitted key is untouched, an explicit null clears it (spec 20.4). */
export const fieldValuePatchSchema = z.record(z.string(), fieldValueSchema.nullable());

export const createFieldRequestSchema = z.object({
  name: fieldNameSchema,
  /** Derived from the name when omitted. */
  key: fieldKeySchema.optional(),
  type: fieldTypeSchema,
  options: z.array(z.string().trim().max(60)).max(MAX_SELECT_OPTIONS).optional(),
  showOnCard: z.boolean().optional(),
});

/** The key and the type are immutable: changing either would reinterpret stored values. */
export const updateFieldRequestSchema = z
  .object({
    name: fieldNameSchema.optional(),
    options: z.array(z.string().trim().max(60)).max(MAX_SELECT_OPTIONS).optional(),
    showOnCard: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const fieldFilterOperatorSchema = z.enum([
  "eq",
  "ne",
  "lt",
  "gt",
  "between",
  "empty",
]);

/**
 * One field filter, as stored in a saved view and as the list query carries it. On the
 * wire a list query spells it `field.<key>=<op>[:<value>]`; `between` takes `low..high`.
 */
export const fieldFilterSchema = z.object({
  key: z.string(),
  op: fieldFilterOperatorSchema,
  value: fieldValueSchema.nullable(),
  upper: fieldValueSchema.nullable(),
});

export const fieldResponseSchema = z.object({ data: fieldDefinitionSchema });
export const fieldListResponseSchema = z.object({
  data: z.array(fieldDefinitionListItemSchema),
});

export type FieldType = z.infer<typeof fieldTypeSchema>;
export type FieldDefinitionDto = z.infer<typeof fieldDefinitionSchema>;
export type FieldDefinitionListItemDto = z.infer<typeof fieldDefinitionListItemSchema>;
export type FieldValueDto = z.infer<typeof fieldValueSchema>;
export type FieldValuesDto = z.infer<typeof fieldValuesSchema>;
export type FieldValuePatchDto = z.infer<typeof fieldValuePatchSchema>;
export type FieldFilterOperator = z.infer<typeof fieldFilterOperatorSchema>;
export type FieldFilterDto = z.infer<typeof fieldFilterSchema>;
export type CreateFieldRequest = z.infer<typeof createFieldRequestSchema>;
export type UpdateFieldRequest = z.infer<typeof updateFieldRequestSchema>;
export type FieldListResponse = z.infer<typeof fieldListResponseSchema>;
