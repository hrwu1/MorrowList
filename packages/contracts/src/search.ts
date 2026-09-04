import { z } from "zod";

import {
  paginated,
  paginationQuerySchema,
  prioritySchema,
  uuidSchema,
} from "./common.js";
import { projectSchema } from "./project.js";
import { dueFilterSchema, taskSchema } from "./task.js";

/**
 * Search (spec 9.8, 20.3 `GET /search`). `q` is free text plus the operator grammar
 * defined in `@morrowlist/domain`; the explicit filters are the task list's, and an
 * operator in `q` overrides the same explicit filter.
 */

export const searchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(500),
  projectId: uuidSchema.optional(),
  statusId: uuidSchema.optional(),
  priority: prioritySchema.optional(),
  tagId: uuidSchema.optional(),
  isCompleted: z.stringbool().optional(),
  isBlocked: z.stringbool().optional(),
  due: dueFilterSchema.optional(),
  inbox: z.stringbool().optional(),
  includeSubtasks: z.stringbool().default(true),
});

/**
 * A half-open character range inside the field it belongs to. Offsets, never markup:
 * the client renders the highlight itself and no HTML travels over the wire.
 */
export const matchRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

export const searchTaskResultSchema = z.object({
  task: taskSchema,
  matches: z.object({
    title: z.array(matchRangeSchema),
    description: z.array(matchRangeSchema),
  }),
});

/** Project name hits, for navigation; bounded and unpaginated. */
export const searchProjectResultSchema = z.object({
  project: projectSchema,
  matches: z.array(matchRangeSchema),
});

export const SEARCH_PROJECT_LIMIT = 5;

export const searchResponseSchema = paginated(searchTaskResultSchema).extend({
  data: z.object({
    tasks: z.array(searchTaskResultSchema),
    projects: z.array(searchProjectResultSchema),
  }),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type MatchRangeDto = z.infer<typeof matchRangeSchema>;
export type SearchTaskResultDto = z.infer<typeof searchTaskResultSchema>;
export type SearchProjectResultDto = z.infer<typeof searchProjectResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
