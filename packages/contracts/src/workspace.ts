import { z } from "zod";

import { timezoneSchema, uuidSchema } from "./common.js";

/** Workspace and identity transport schemas (spec 20.3). */

export const workspaceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  taskKeyPrefix: z.string(),
  timezone: timezoneSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const workspaceRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);

export const userSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** `GET /me` returns the caller, their workspaces, and what this credential may do. */
export const meResponseSchema = z.object({
  data: z.object({
    user: userSchema,
    workspaces: z.array(workspaceSchema.extend({ role: workspaceRoleSchema })),
    defaultWorkspaceId: uuidSchema,
    capabilities: z.object({
      actorKind: z.enum(["user", "api_key"]),
      scopes: z.array(z.string()),
    }),
  }),
});

export const updateWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    taskKeyPrefix: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z][A-Za-z0-9]{0,9}$/,
        "must start with a letter, max 10 characters",
      )
      .optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export type WorkspaceDto = z.infer<typeof workspaceSchema>;
export type UserDto = z.infer<typeof userSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
