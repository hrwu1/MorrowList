import {
  createFieldRequestSchema,
  updateFieldRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/**
 * Typed custom-field endpoints (GAP-24, spec 20.3). Each route validates transport input
 * and calls exactly one use case; the cap of ten lives in `FieldService`.
 */
export function fieldRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/fields", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.fieldService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      );
    })

    .post("/fields", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createFieldRequestSchema);
      const field = await deps.fieldService.create(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        body,
      );
      return c.json({ data: field }, 201);
    })

    .patch("/fields/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateFieldRequestSchema);
      const field = await deps.fieldService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: field });
    })

    .delete("/fields/:id", async (c) => {
      const actor = c.get("actor");
      await deps.fieldService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.body(null, 204);
    });
}
