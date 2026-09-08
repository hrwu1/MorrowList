import { z } from "zod";

import { boardLaneSchema, boardPlacementSchema, boardSwimlaneSchema } from "./board.js";
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

/** PATCH semantics: an omitted field is untouched, an explicit null clears (spec 20.4). */
export const updateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    descriptionMd: z.string().max(50_000).nullable().optional(),
    colorToken: z.string().max(50).optional(),
    icon: z.string().max(80).nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), {
    message: "at least one field must be supplied",
  });

export const projectVersionRequestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

/** Archived projects stay out of navigation unless asked for (spec 8.6). */
export const listProjectsQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
});

export const listStatusesQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
});

export const statusNameSchema = z.string().trim().min(1).max(80);
const policyMdSchema = z.string().max(10_000);

export const createStatusRequestSchema = z.object({
  name: statusNameSchema,
  category: statusCategorySchema,
  colorToken: z.string().max(50).optional(),
  wipLimit: z.number().int().positive().nullish(),
  policyMd: policyMdSchema.nullish(),
});

export const updateStatusRequestSchema = z
  .object({
    name: statusNameSchema.optional(),
    category: statusCategorySchema.optional(),
    colorToken: z.string().max(50).optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
    isDefault: z.boolean().optional(),
    policyMd: policyMdSchema.nullable().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== "expectedVersion"), {
    message: "at least one field must be supplied",
  });

/** Neighbours describe the intended position; the server computes the rank (spec 24.1). */
export const reorderStatusRequestSchema = z
  .object({
    beforeStatusId: uuidSchema.nullish(),
    afterStatusId: uuidSchema.nullish(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine(
    (body) =>
      body.beforeStatusId == null ||
      body.afterStatusId == null ||
      body.beforeStatusId !== body.afterStatusId,
    {
      message: "beforeStatusId and afterStatusId must be different statuses",
      path: ["afterStatusId"],
    },
  );

/**
 * Move every task of the column to `destinationStatusId`, then archive it, atomically
 * (spec 11.4). `newDefaultStatusId` is needed when the default column is archived and
 * the destination should not become the default.
 */
export const archiveStatusRequestSchema = z.object({
  destinationStatusId: uuidSchema.nullish(),
  newDefaultStatusId: uuidSchema.nullish(),
  expectedVersion: z.number().int().positive().optional(),
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
  /** Deferred tasks stay off the board until their defer date unless asked for (GAP-16). */
  includeDeferred: z.stringbool().default(false),
  /** The second axis the board is read along; columns stay statuses (GAP-19). */
  swimlaneBy: boardSwimlaneSchema.default("none"),
});

export const projectDetailSchema = z.object({
  project: projectSchema,
  statuses: z.array(workflowStatusSchema),
});

export const projectBoardSchema = projectDetailSchema.extend({
  tasks: z.array(taskSchema),
  swimlaneBy: boardSwimlaneSchema,
  /** Lane rows in display order; a single unnamed lane when `swimlaneBy` is `none`. */
  lanes: z.array(boardLaneSchema),
  /** The cell each task falls in: `status:<id>` column, lane key. */
  placements: z.array(boardPlacementSchema),
});

export const projectResponseSchema = z.object({
  data: projectDetailSchema,
});
export const workflowStatusResponseSchema = z.object({ data: workflowStatusSchema });
export const workflowStatusListResponseSchema = z.object({
  data: z.array(workflowStatusSchema),
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
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ProjectVersionRequest = z.infer<typeof projectVersionRequestSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ListStatusesQuery = z.infer<typeof listStatusesQuerySchema>;
export type CreateStatusRequest = z.infer<typeof createStatusRequestSchema>;
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>;
export type ReorderStatusRequest = z.infer<typeof reorderStatusRequestSchema>;
export type ArchiveStatusRequest = z.infer<typeof archiveStatusRequestSchema>;
export type WorkflowStatusResponse = z.infer<typeof workflowStatusResponseSchema>;
export type WorkflowStatusListResponse = z.infer<
  typeof workflowStatusListResponseSchema
>;
export type ProjectBoardQuery = z.infer<typeof projectBoardQuerySchema>;
export type ProjectDetailDto = z.infer<typeof projectDetailSchema>;
export type ProjectBoardDto = z.infer<typeof projectBoardSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectBoardResponse = z.infer<typeof projectBoardResponseSchema>;
