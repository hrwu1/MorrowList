import { z } from "zod";

import { plainDateSchema } from "./common.js";
import { taskSchema } from "./task.js";

/** Built-in view projections (spec 9.2, 9.3, 20.3 `/views/*`). */

export const todayReasonSchema = z.enum(["overdue", "due_today", "my_day"]);

export const todayEntrySchema = z.object({
  task: taskSchema,
  /** Every reason the task is in Today; the first is the section it appears under. */
  reasons: z.array(todayReasonSchema),
});

export const todaySectionSchema = z.object({
  id: todayReasonSchema,
  tasks: z.array(todayEntrySchema),
});

export const todayViewSchema = z.object({
  /** The workspace-local date the view was evaluated for. */
  date: plainDateSchema,
  sections: z.array(todaySectionSchema),
  /**
   * Yesterday's unfinished manual selections, for the review banner (spec 9.2). Null when
   * there is nothing to review or when a date other than today was requested.
   */
  review: z.object({ date: plainDateSchema, tasks: z.array(taskSchema) }).nullable(),
});

export const todayViewQuerySchema = z.object({
  /** Defaults to the workspace's current date. */
  date: plainDateSchema.optional(),
});

export const todayViewResponseSchema = z.object({ data: todayViewSchema });

export const UPCOMING_HORIZONS = ["7", "14", "30", "all"] as const;
export const upcomingHorizonSchema = z.enum(UPCOMING_HORIZONS);

/** Upcoming reads at most this many tasks; the response says when it stopped short. */
export const UPCOMING_TASK_LIMIT = 500;

export const upcomingViewQuerySchema = z.object({
  /** Defaults to the workspace's current date; groups start the day after. */
  from: plainDateSchema.optional(),
  horizon: upcomingHorizonSchema.default("14"),
});

export const upcomingGroupSchema = z.object({
  date: plainDateSchema,
  tasks: z.array(taskSchema),
});

export const upcomingViewSchema = z.object({
  from: plainDateSchema,
  horizon: upcomingHorizonSchema,
  groups: z.array(upcomingGroupSchema),
  /** True when more future tasks exist than the bounded read returned. */
  truncated: z.boolean(),
});

export const upcomingViewResponseSchema = z.object({ data: upcomingViewSchema });

export type TodayReason = z.infer<typeof todayReasonSchema>;
export type TodayEntryDto = z.infer<typeof todayEntrySchema>;
export type TodaySectionDto = z.infer<typeof todaySectionSchema>;
export type TodayViewDto = z.infer<typeof todayViewSchema>;
export type TodayViewQuery = z.infer<typeof todayViewQuerySchema>;
export type TodayViewResponse = z.infer<typeof todayViewResponseSchema>;
export type UpcomingHorizon = z.infer<typeof upcomingHorizonSchema>;
export type UpcomingViewQuery = z.infer<typeof upcomingViewQuerySchema>;
export type UpcomingGroupDto = z.infer<typeof upcomingGroupSchema>;
export type UpcomingViewDto = z.infer<typeof upcomingViewSchema>;
export type UpcomingViewResponse = z.infer<typeof upcomingViewResponseSchema>;
