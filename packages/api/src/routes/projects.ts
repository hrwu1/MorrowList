import {
  createProjectRequestSchema,
  projectBoardQuerySchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Project and normalized board endpoints (spec 20.3, BRD-001). */
export function projectRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/projects", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.projectService.list(actor, {
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        }),
      );
    })

    .post("/projects", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createProjectRequestSchema);
      const project = await deps.projectService.create(actor, {
        ...body,
        workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
      });
      return c.json({ data: project }, 201);
    })

    .get("/projects/:projectId/board", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), projectBoardQuerySchema);
      return c.json(
        await deps.projectService.board(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("projectId"),
          { limit: query.limit },
        ),
      );
    })

    .get("/projects/:projectId", async (c) => {
      const actor = c.get("actor");
      const project = await deps.projectService.get(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
      );
      return c.json({ data: project });
    });
}
