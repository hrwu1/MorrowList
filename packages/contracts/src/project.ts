import { z } from "zod";

import { paginated, statusCategorySchema, uuidSchema } from "./common.js";

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

export const projectResponseSchema = z.object({
  data: projectSchema.extend({ statuses: z.array(workflowStatusSchema) }),
});
export const projectListResponseSchema = paginated(projectSchema);

export type ProjectDto = z.infer<typeof projectSchema>;
export type WorkflowStatusDto = z.infer<typeof workflowStatusSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
