import {
  boardViewQuerySchema,
  createSavedViewRequestSchema,
  reorderSavedViewRequestSchema,
  todayViewQuerySchema,
  upcomingViewQuerySchema,
  updateSavedViewRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Built-in view projections and personal saved views (spec 20.3 `/views/*`). */
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
    })

    .get("/views/board", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), boardViewQuerySchema);
      return c.json(
        await deps.viewService.board(actor, {
          ...query,
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        }),
      );
    })

    .get("/views/saved", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.savedViewService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      );
    })

    .post("/views/saved", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createSavedViewRequestSchema);
      const view = await deps.savedViewService.create(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        body,
      );
      return c.json({ data: view }, 201);
    })

    .patch("/views/saved/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateSavedViewRequestSchema);
      const view = await deps.savedViewService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: view });
    })

    .delete("/views/saved/:id", async (c) => {
      const actor = c.get("actor");
      await deps.savedViewService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.body(null, 204);
    })

    .post("/views/saved/:id/reorder", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, reorderSavedViewRequestSchema);
      const view = await deps.savedViewService.reorder(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: view });
    });
}
