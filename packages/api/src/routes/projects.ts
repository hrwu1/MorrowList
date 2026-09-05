import {
  activityQuerySchema,
  createProjectRequestSchema,
  createStatusRequestSchema,
  flowQuerySchema,
  listProjectsQuerySchema,
  listStatusesQuerySchema,
  projectBoardQuerySchema,
  projectVersionRequestSchema,
  updateProjectRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/** Project, workflow-status, and normalized board endpoints (spec 20.3, BRD-001). */
export function projectRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/projects", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listProjectsQuerySchema);
      return c.json(
        await deps.projectService.list(actor, {
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          includeArchived: query.includeArchived,
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
          {
            limit: query.limit,
            includeSubtasks: query.includeSubtasks,
            includeDeferred: query.includeDeferred,
            swimlaneBy: query.swimlaneBy,
          },
        ),
      );
    })

    .get("/projects/:projectId/activity", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), activityQuerySchema);
      return c.json(
        await deps.activityService.listForProject(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("projectId"),
          query,
        ),
      );
    })

    .get("/projects/:projectId/statuses", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listStatusesQuerySchema);
      const statuses = await deps.workflowService.list(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
        { includeArchived: query.includeArchived },
      );
      return c.json({ data: statuses });
    })

    .post("/projects/:projectId/statuses", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createStatusRequestSchema);
      const status = await deps.workflowService.create(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
        body,
      );
      return c.json({ data: status }, 201);
    })

    .get("/projects/:projectId/flow", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), flowQuerySchema);
      return c.json({
        data: await deps.flowService.project(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("projectId"),
          query,
        ),
      });
    })

    .get("/projects/:projectId", async (c) => {
      const actor = c.get("actor");
      const project = await deps.projectService.get(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
      );
      return c.json({ data: project });
    })

    .patch("/projects/:projectId", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateProjectRequestSchema);
      const project = await deps.projectService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
        body,
      );
      return c.json({ data: project });
    })

    .post("/projects/:projectId/archive", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, projectVersionRequestSchema);
      const project = await deps.projectService.archive(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
        body.expectedVersion,
      );
      return c.json({ data: project });
    })

    .post("/projects/:projectId/restore", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, projectVersionRequestSchema);
      const project = await deps.projectService.restore(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("projectId"),
        body.expectedVersion,
      );
      return c.json({ data: project });
    });
}
