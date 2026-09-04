import { searchQuerySchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** `GET /search` (spec 9.8, 20.3): one query, one use case. */
export function searchRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>().get("/search", async (c) => {
    const actor = c.get("actor");
    const query = parseQuery(c.req.query(), searchQuerySchema);
    return c.json(
      await deps.searchService.search(actor, {
        ...query,
        workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
      }),
    );
  });
}
