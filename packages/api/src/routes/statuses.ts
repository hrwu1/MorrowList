import {
  archiveStatusRequestSchema,
  reorderStatusRequestSchema,
  updateStatusRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Workflow status endpoints (spec 20.3). Each validates and calls one use case. */
export function statusRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .patch("/statuses/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateStatusRequestSchema);
      const status = await deps.workflowService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: status });
    })

    .post("/statuses/:id/reorder", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, reorderStatusRequestSchema);
      const status = await deps.workflowService.reorder(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: status });
    })

    .post("/statuses/:id/archive", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, archiveStatusRequestSchema);
      const status = await deps.workflowService.archive(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: status });
    });
}
