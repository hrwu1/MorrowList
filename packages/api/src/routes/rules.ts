import {
  createRuleRequestSchema,
  listRuleRunsQuerySchema,
  testRuleRequestSchema,
  updateRuleRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";
export function ruleRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/rules", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.ruleService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      );
    })
    .post("/rules", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createRuleRequestSchema);
      return c.json(
        {
          data: await deps.ruleService.create(
            actor,
            requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
            body,
          ),
        },
        201,
      );
    })
    .patch("/rules/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateRuleRequestSchema);
      return c.json({
        data: await deps.ruleService.update(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          body,
        ),
      });
    })
    .delete("/rules/:id", async (c) => {
      const actor = c.get("actor");
      await deps.ruleService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.body(null, 204);
    })
    .get("/rules/:id/runs", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listRuleRunsQuerySchema);
      return c.json(
        await deps.ruleService.runs(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          query.limit,
        ),
      );
    })
    .post("/rules/:id/test", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, testRuleRequestSchema);
      return c.json({
        data: await deps.ruleService.test(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          body.taskId,
        ),
      });
    });
}
