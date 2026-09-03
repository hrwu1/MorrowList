import {
  activityQuerySchema,
  addTaskToDayRequestSchema,
  completeTaskRequestSchema,
  createTaskRequestSchema,
  listTasksQuerySchema,
  moveTaskRequestSchema,
  reorderTaskRequestSchema,
  reopenTaskRequestSchema,
  updateTaskRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";
import type { z } from "zod";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/**
 * Task endpoints (spec 20.3). Each route validates transport input, resolves the target
 * workspace, and calls exactly one application use case. No business rule lives here.
 */
export function taskRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/tasks", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listTasksQuerySchema);
      const result = await deps.taskService.list(actor, {
        ...query,
        workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
      });
      return c.json(result);
    })

    .post("/tasks", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createTaskRequestSchema);
      const task = await deps.taskService.create(actor, {
        ...body,
        workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
      });
      return c.json({ data: task }, 201);
    })

    .get("/tasks/:idOrKey", async (c) => {
      const actor = c.get("actor");
      const task = await deps.taskService.get(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("idOrKey"),
      );
      return c.json({ data: task });
    })

    .get("/tasks/:idOrKey/activity", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), activityQuerySchema);
      const result = await deps.activityService.listForTask(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("idOrKey"),
        query,
      );
      return c.json(result);
    })

    .patch("/tasks/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateTaskRequestSchema);
      const task = await deps.taskService.update(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/move", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, moveTaskRequestSchema);
      const task = await deps.taskService.move(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/reorder", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, reorderTaskRequestSchema);
      const task = await deps.taskService.reorder(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/complete", async (c) => {
      const actor = c.get("actor");
      const body = await parseOptionalBody(c, completeTaskRequestSchema);
      const task = await deps.taskService.complete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body.expectedVersion,
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/reopen", async (c) => {
      const actor = c.get("actor");
      const body = await parseOptionalBody(c, reopenTaskRequestSchema);
      const task = await deps.taskService.reopen(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body.expectedVersion,
      );
      return c.json({ data: task });
    })

    .delete("/tasks/:id", async (c) => {
      const actor = c.get("actor");
      const task = await deps.taskService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        expectedVersionFrom(c.req.query("expectedVersion")),
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/restore", async (c) => {
      const actor = c.get("actor");
      const task = await deps.taskService.restore(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        expectedVersionFrom(c.req.query("expectedVersion")),
      );
      return c.json({ data: task });
    })

    .post("/tasks/:id/today", async (c) => {
      const actor = c.get("actor");
      const body = await parseOptionalBody(c, addTaskToDayRequestSchema);
      const task = await deps.taskService.addToDay(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        body,
      );
      return c.json({ data: task });
    })

    .delete("/tasks/:id/today/:date", async (c) => {
      const actor = c.get("actor");
      const task = await deps.taskService.removeFromDay(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
        parseQuery({ date: c.req.param("date") }, addTaskToDayRequestSchema).date ?? "",
      );
      return c.json({ data: task });
    });
}

function expectedVersionFrom(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "expectedVersion must be a positive integer.",
      {
        field: "expectedVersion",
      },
    );
  }
  return parsed;
}

/** POST bodies on action endpoints are optional; an absent body means "no options". */
async function parseOptionalBody<T extends z.ZodType>(
  c: { req: { text(): Promise<string> } },
  schema: T,
): Promise<z.infer<T>> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return parseQuery({}, schema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return parseQuery(parsed as Record<string, string | undefined>, schema);
}
