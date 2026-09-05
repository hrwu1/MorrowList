import {
  importQuerySchema,
  importRequestSchema,
  importSourceSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/**
 * Importing another tool's export (spec 30, GAP-07).
 *
 * `?dryRun=true` runs the same mapping and writes nothing, so a person sees the columns,
 * tags and counts before approving. The body is JSON with the file's text in `content`,
 * which the browser, the CLI and curl can all produce; `app.ts` allows 10 MB here.
 */
export function importRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>().post("/imports/:source", async (c) => {
    const actor = c.get("actor");
    const parsed = importSourceSchema.safeParse(c.req.param("source"));
    if (!parsed.success) {
      throw new ApiError("NOT_FOUND", "No importer for that source.", {
        source: c.req.param("source"),
        supported: importSourceSchema.options,
      });
    }

    const query = parseQuery(c.req.query(), importQuerySchema);
    const body = await parseJsonBody(c, importRequestSchema);
    const workspaceId = requireWorkspace(
      c.req.query("workspaceId"),
      actor.workspaceIds,
    );

    const result = await deps.importService.apply(actor, workspaceId, parsed.data, {
      ...body,
      dryRun: query.dryRun,
    });
    return c.json({ data: result }, query.dryRun ? 200 : 201);
  });
}
