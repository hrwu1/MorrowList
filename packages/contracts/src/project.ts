import { z } from "zod";

import { paginated, statusCategorySchema, uuidSchema } from "./common.js";
import { taskSchema } from "./task.js";

/** Project and workflow status transport schemas (spec 20.3). */

export const workflowStatusSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  name: z.string(),
  category: statusCategorySchema,
  rank: z.string(),
  colorToken: z.string(),
  wipLimit: z.number().int().positive().nullable(),
  isDefault: z.boolean(),
  isTerminal: z.boolean(),
  policyMd: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
});

export const projectSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  slug: z.string(),
  descriptionMd: z.string().nullable(),
  colorToken: z.string(),
  icon: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  descriptionMd: z.string().max(50_000).nullish(),
  colorToken: z.string().max(50).optional(),
  icon: z.string().max(80).nullish(),
});

export const PROJECT_BOARD_TASK_LIMIT = 500;

/**
 * A board is intentionally bounded: the UI receives one normalized projection rather
 * than making one task request per status, and the response says when that projection
 * was truncated instead of silently dropping work.
 */
export const projectBoardQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PROJECT_BOARD_TASK_LIMIT)
    .default(PROJECT_BOARD_TASK_LIMIT),
  /** Boards hide subtasks by default; the parent card shows their progress (spec 8.3). */
  includeSubtasks: z.stringbool().default(false),
});

export const projectDetailSchema = z.object({
  project: projectSchema,
  statuses: z.array(workflowStatusSchema),
});

export const projectBoardSchema = projectDetailSchema.extend({
  tasks: z.array(taskSchema),
});

export const projectResponseSchema = z.object({
  data: projectDetailSchema,
});
export const projectListResponseSchema = paginated(projectSchema);
export const projectBoardResponseSchema = z.object({
  data: projectBoardSchema,
  page: z.object({
    hasMore: z.boolean(),
    truncated: z.boolean(),
  }),
});

export type ProjectDto = z.infer<typeof projectSchema>;
export type WorkflowStatusDto = z.infer<typeof workflowStatusSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type ProjectBoardQuery = z.infer<typeof projectBoardQuerySchema>;
export type ProjectDetailDto = z.infer<typeof projectDetailSchema>;
export type ProjectBoardDto = z.infer<typeof projectBoardSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectBoardResponse = z.infer<typeof projectBoardResponseSchema>;
