import { createTagRequestSchema, updateTagRequestSchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Tag endpoints (spec 20.3, TASK-008). Each route calls exactly one use case. */
export function tagRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/tags", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.tagService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      );
    })

    .post("/tags", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createTagRequestSchema);
      const tag = await deps.tagService.create(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        body,
      );
      return c.json({ data: tag }, 201);
    })

    .patch("/tags/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateTagRequestSchema);
      const tag = await deps.tagService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: tag });
    })

    .delete("/tags/:id", async (c) => {
      const actor = c.get("actor");
      await deps.tagService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.body(null, 204);
    });
}
