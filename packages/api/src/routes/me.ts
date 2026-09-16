import {
  createApiTokenRequestSchema,
  pushSubscriptionRequestSchema,
  updateNotificationPreferencesRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { parseJsonBody } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/**
 * `GET /me` — the caller, their workspaces, and what this credential may do (spec 20.3) —
 * plus the caller's own notification preferences, push registrations, and whether this
 * deployment can send push at all (GAP-13).
 */
export function meRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/me/notification-preferences", async (c) => {
      const actor = c.get("actor");
      return c.json({
        data: await deps.notificationService.getPreferences(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      });
    })

    .patch("/me/notification-preferences", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateNotificationPreferencesRequestSchema);
      return c.json({
        data: await deps.notificationService.updatePreferences(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          body,
        ),
      });
    })

    .post("/me/push-subscriptions", async (c) => {
      const body = await parseJsonBody(c, pushSubscriptionRequestSchema);
      const subscription = await deps.notificationService.addPushSubscription(
        c.get("actor"),
        body,
      );
      return c.json({ data: subscription }, 201);
    })

    .delete("/me/push-subscriptions", async (c) => {
      const endpoint = c.req.query("endpoint");
      if (!endpoint) {
        throw new ApiError("VALIDATION_FAILED", "endpoint is required.", {
          field: "endpoint",
        });
      }
      await deps.notificationService.removePushSubscription(c.get("actor"), endpoint);
      return c.body(null, 204);
    })

    .post("/me/tokens", async (c) => {
      // A token is a credential in its own right (the CLI's key, a CalDAV password), so
      // holding a session is not enough to mint one: the account password is re-checked.
      const user = await deps.auth.resolveUser(c.req.raw.headers);
      if (!user) throw new ApiError("AUTH_REQUIRED", "Sign in to continue.");
      const body = await parseJsonBody(c, createApiTokenRequestSchema);
      const issued = await deps.auth.issueToken(user.email, body.password);
      if (!issued) throw new ApiError("AUTH_FORBIDDEN", "The password did not match.");
      c.header("Cache-Control", "no-store");
      return c.json({ data: issued }, 201);
    })

    .get("/me/push-config", (c) => {
      // The public key is public by design: a browser must present it to subscribe. The
      // private half stays in the server's environment and is never reachable from here.
      const publicKey = deps.pushPublicKey ?? null;
      return c.json({ data: { enabled: publicKey !== null, publicKey } });
    })

    .get("/me", async (c) => {
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
