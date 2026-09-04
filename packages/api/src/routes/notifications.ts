import { listNotificationsQuerySchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** The in-app notification inbox (GAP-13, spec 20.3). One use case per route. */
export function notificationRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/notifications", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listNotificationsQuerySchema);
      return c.json(
        await deps.notificationService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          query,
        ),
      );
    })

    .post("/notifications/:id/read", async (c) => {
      const actor = c.get("actor");
      const notification = await deps.notificationService.markRead(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.json({ data: notification });
    })

    .post("/notifications/:id/snooze", async (c) => {
      const actor = c.get("actor");
      const notification = await deps.notificationService.snooze(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.json({ data: notification });
    });
}
