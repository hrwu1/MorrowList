import { userActorContext, type AuthPort } from "@morrowlist/auth";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";

/**
 * Authentication and ActorContext construction (spec 17.3 steps 2–3, AUTH-004).
 *
 * The workspace list is resolved from membership on every request rather than trusted
 * from the client, so a caller can never widen their own scope.
 */
export function authenticate(
  auth: AuthPort,
  listWorkspaceIds: (userId: string) => Promise<readonly string[]>,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const user = await auth.resolveUser(c.req.raw.headers);
    if (!user) {
      throw new ApiError("AUTH_REQUIRED", "Sign in to continue.");
    }

    const workspaceIds = await listWorkspaceIds(user.id);
    c.set("actor", userActorContext(user, workspaceIds, c.get("requestId")));
    await next();
  };
}
