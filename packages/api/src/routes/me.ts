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

    // The identity fields come from the auth provider, not from ActorContext: the actor
    // carries a display name for audit attribution, which is not an email address.
    const user = await deps.auth.resolveUser(c.req.raw.headers);
    if (!user) {
      throw new ApiError("AUTH_REQUIRED", "Sign in to continue.");
    }

    // Each workspace carries its in-progress limit and count (GAP-20), so a shell can
    // show "3 of 3 in progress" from this one call.
    const workspaces = await deps.workspaceService.listForUser(actor);
    const defaultWorkspace = workspaces[0];
    if (!defaultWorkspace) {
      throw new ApiError("WORKSPACE_NOT_FOUND", "No workspace is available yet.");
    }

    return c.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
        workspaces,
        defaultWorkspaceId: defaultWorkspace.id,
        capabilities: {
          actorKind: actor.actorKind === "api_key" ? "api_key" : "user",
          scopes: [...actor.scopes],
        },
      },
    });
  });
}
