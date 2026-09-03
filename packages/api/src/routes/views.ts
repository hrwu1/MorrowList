import { todayViewQuerySchema, upcomingViewQuerySchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Built-in view projections (spec 20.3 `/views/*`). One query, one use case each. */
export function viewRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/views/today", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), todayViewQuerySchema);
      return c.json(
        await deps.viewService.today(actor, {
          ...query,
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        }),
      );
    })

    .get("/views/upcoming", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), upcomingViewQuerySchema);
      return c.json(
        await deps.viewService.upcoming(actor, {
          ...query,
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        }),
      );
    });
}
