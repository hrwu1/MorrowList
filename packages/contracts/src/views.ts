import { z } from "zod";

import {
  boardColumnSchema,
  boardColumnsBySchema,
  boardLaneSchema,
  boardPlacementSchema,
  boardSwimlaneSchema,
} from "./board.js";
import { plainDateSchema, prioritySchema, uuidSchema } from "./common.js";
import { projectSchema } from "./project.js";
import { deadlineFilterSchema, dueFilterSchema, taskSchema } from "./task.js";

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

/**
 * The cross-project board (spec 9.5, GAP-19): any saved view's filters, or Today,
 * rendered as a board. Like the project board it is bounded and says when it truncated.
 */
export const BOARD_VIEW_TASK_LIMIT = 500;

/**
 * `today` reads the same projection as `/views/today` — overdue, due today, and My Day —
 * because Today's membership is not expressible as a task filter (spec 9.2).
 */
export const boardViewSourceSchema = z.enum(["filters", "today"]);

export const boardViewQuerySchema = z.object({
  source: boardViewSourceSchema.default("filters"),
  columnsBy: boardColumnsBySchema.default("category"),
  swimlaneBy: boardSwimlaneSchema.default("none"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(BOARD_VIEW_TASK_LIMIT)
    .default(BOARD_VIEW_TASK_LIMIT),
  /** The workspace-local day a `today` board is drawn for; defaults to the current one. */
  date: plainDateSchema.optional(),
  /** The saved view's filter set (spec 9.8); ordering is always manual rank (ADR-009). */
  projectId: uuidSchema.optional(),
  priority: prioritySchema.optional(),
  tagId: uuidSchema.optional(),
  isCompleted: z.stringbool().optional(),
  isBlocked: z.stringbool().optional(),
  due: dueFilterSchema.optional(),
  deferred: z.stringbool().optional(),
  deadline: deadlineFilterSchema.optional(),
  inbox: z.stringbool().optional(),
  /** Boards hide subtasks by default; the parent card shows their progress (spec 8.3). */
  includeSubtasks: z.stringbool().default(false),
});

export const boardViewSchema = z.object({
  source: boardViewSourceSchema,
  columnsBy: boardColumnsBySchema,
  swimlaneBy: boardSwimlaneSchema,
  columns: z.array(boardColumnSchema),
  lanes: z.array(boardLaneSchema),
  /** Every project with a card on the board, for card and lane labels. */
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  placements: z.array(boardPlacementSchema),
});

export const boardViewResponseSchema = z.object({
  data: boardViewSchema,
  page: z.object({ hasMore: z.boolean(), truncated: z.boolean() }),
});

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
export type BoardViewSource = z.infer<typeof boardViewSourceSchema>;
export type BoardViewQuery = z.infer<typeof boardViewQuerySchema>;
export type BoardViewDto = z.infer<typeof boardViewSchema>;
export type BoardViewResponse = z.infer<typeof boardViewResponseSchema>;
