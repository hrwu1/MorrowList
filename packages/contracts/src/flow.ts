import { z } from "zod";

import { plainDateSchema, statusCategorySchema, uuidSchema } from "./common.js";

/**
 * Flow metrics (GAP-17): the project-level read model computed from the status intervals
 * every task change records. Read-only; nothing here is ever written by a client.
 */

export const FLOW_RANGES = ["30", "90", "365"] as const;
export const flowRangeSchema = z.enum(FLOW_RANGES);

export const flowQuerySchema = z.object({
  /** Days of history the summary covers, ending today in the workspace timezone. */
  range: flowRangeSchema.default("90"),
});

/** Days, one decimal; null when there are no samples to compute it from. */
const daysSchema = z.number().nonnegative().nullable();

export const flowPercentilesSchema = z.object({
  /** How many completed tasks the percentiles are computed from. */
  samples: z.number().int().nonnegative(),
  p50: daysSchema,
  p85: daysSchema,
  p95: daysSchema,
});

export const flowWeekSchema = z.object({
  weekStart: plainDateSchema,
  count: z.number().int().nonnegative(),
});

export const flowDaySchema = z.object({
  date: plainDateSchema,
  counts: z.record(statusCategorySchema, z.number().int().nonnegative()),
});

export const agingBandSchema = z.enum([
  "under_p50",
  "over_p50",
  "over_p85",
  "over_p95",
]);

export const agingItemSchema = z.object({
  taskId: uuidSchema,
  key: z.string(),
  title: z.string(),
  statusId: uuidSchema,
  statusName: z.string(),
  category: statusCategorySchema,
  ageDays: z.number().nonnegative(),
  /** The cycle-time percentile the age has passed; null without a reference yet. */
  band: agingBandSchema.nullable(),
});

export const flowSummarySchema = z.object({
  projectId: uuidSchema,
  range: flowRangeSchema,
  from: plainDateSchema,
  to: plainDateSchema,
  timezone: z.string(),
  computedAt: z.iso.datetime(),
  /** Started, open tasks on the board right now. */
  wip: z.number().int().nonnegative(),
  /** Tasks completed inside the range. */
  completed: z.number().int().nonnegative(),
  cycleTimeDays: flowPercentilesSchema,
  leadTimeDays: flowPercentilesSchema,
  throughput: z.array(flowWeekSchema),
  cumulativeFlow: z.array(flowDaySchema),
  /** Started, open tasks oldest first. */
  aging: z.array(agingItemSchema),
});

export const flowResponseSchema = z.object({ data: flowSummarySchema });

export type FlowRange = z.infer<typeof flowRangeSchema>;
export type FlowQuery = z.infer<typeof flowQuerySchema>;
export type FlowPercentilesDto = z.infer<typeof flowPercentilesSchema>;
export type FlowWeekDto = z.infer<typeof flowWeekSchema>;
export type FlowDayDto = z.infer<typeof flowDaySchema>;
export type AgingBandDto = z.infer<typeof agingBandSchema>;
export type AgingItemDto = z.infer<typeof agingItemSchema>;
export type FlowSummaryDto = z.infer<typeof flowSummarySchema>;
export type FlowResponse = z.infer<typeof flowResponseSchema>;
