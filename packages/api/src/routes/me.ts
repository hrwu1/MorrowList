import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";

/** `GET /me` — the caller, their workspaces, and what this credential may do (spec 20.3). */
export function meRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>().get("/me", async (c) => {
    const actor = c.get("actor");
    const userId = actor.userId;
    if (!userId) {
      throw new ApiError("AUTH_FORBIDDEN", "This credential is not tied to a user.");
    }

    const workspaces = await deps.unitOfWork.execute((tx) =>
      tx.workspaces.listForUser(userId),
    );
    const defaultWorkspace = workspaces[0];
    if (!defaultWorkspace) {
      throw new ApiError("WORKSPACE_NOT_FOUND", "No workspace is available yet.");
    }

    return c.json({
      data: {
        user: {
          id: userId,
          email: actor.actorDisplayName ?? "",
          name: actor.actorDisplayName ?? null,
        },
        workspaces: workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          taskKeyPrefix: workspace.taskKeyPrefix,
          timezone: workspace.timezone,
          role: workspace.role,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        })),
        defaultWorkspaceId: defaultWorkspace.id,
        capabilities: {
          actorKind: actor.actorKind === "api_key" ? "api_key" : "user",
          scopes: [...actor.scopes],
        },
      },
    });
  });
}
