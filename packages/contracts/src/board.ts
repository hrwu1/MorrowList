import { z } from "zod";

import { statusCategorySchema, uuidSchema } from "./common.js";

/**
 * Board pivots (spec 9.5, GAP-19).
 *
 * A board's columns stay workflow states (ADR-002); a swimlane is the second axis it is
 * read along. Both the project board and the cross-project view board answer with the
 * same lane vocabulary, so one client renders either.
 */

export const BOARD_SWIMLANES = [
  "none",
  "priority",
  "project",
  "tag",
  "due",
  "parent",
] as const;
export const boardSwimlaneSchema = z.enum(BOARD_SWIMLANES);

/**
 * Columns are one project's statuses, or the semantic categories every project shares.
 * Status names differ per project (spec 11.3), so a board spanning projects can only
 * line work up by category.
 */
export const boardColumnsBySchema = z.enum(["status", "category"]);

/**
 * One lane row. `key` identifies it for drop targets and collapse state and is stable
 * across reloads; `value` is the attribute a card gains when dropped into the lane, read
 * against the board's `swimlaneBy` (a priority, a project id, or a tag id). `writable`
 * says a cross-lane drop is a real mutation rather than a rejected drop.
 */
export const boardLaneSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  writable: z.boolean(),
  colorToken: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

/**
 * One board column. `statusId` is set only when the column is a project's own workflow
 * status; a category column resolves to a per-project status when a card lands in it
 * (spec 11.5).
 */
export const boardColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: statusCategorySchema,
  statusId: uuidSchema.nullable(),
  isTerminal: z.boolean(),
  wipLimit: z.number().int().positive().nullable(),
  colorToken: z.string(),
});

/**
 * Where one card sits. The board keeps a single flat `tasks[]` (ADR-001: one task, one
 * representation) and says separately which cell each task falls in, so the client does
 * no grouping it cannot test and no task DTO grows a view-only field.
 */
export const boardPlacementSchema = z.object({
  taskId: uuidSchema,
  columnKey: z.string(),
  laneKey: z.string(),
});

export type BoardSwimlane = z.infer<typeof boardSwimlaneSchema>;
export type BoardColumnsBy = z.infer<typeof boardColumnsBySchema>;
export type BoardLaneDto = z.infer<typeof boardLaneSchema>;
export type BoardColumnDto = z.infer<typeof boardColumnSchema>;
export type BoardPlacementDto = z.infer<typeof boardPlacementSchema>;
