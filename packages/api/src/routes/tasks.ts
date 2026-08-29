import {
  completeTaskRequestSchema,
  createTaskRequestSchema,
  listTasksQuerySchema,
  reopenTaskRequestSchema,
  updateTaskRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

/**
 * Task endpoints (spec 20.3). Each route validates transport input, resolves the target
 * workspace, and calls exactly one application use case. No business rule lives here.
 */
export function taskRoutes(deps: ApiDependencies) {
  return (
    new Hono<ApiEnv>()
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
  );
}

/**
 * Resolve the target workspace. Omitting it uses the caller's only workspace, which keeps
 * the personal-first MVP simple (ADR-010) without hardcoding a single-workspace model.
 */
function requireWorkspace(
  requested: string | undefined,
  available: readonly string[],
): string {
  if (requested) return requested;
  const only = available[0];
  if (available.length === 1 && only) return only;
  throw new ApiError(
    "VALIDATION_FAILED",
    "workspaceId is required when the caller can reach more than one workspace.",
    { field: "workspaceId" },
  );
}

function expectedVersionFrom(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError("VALIDATION_FAILED", "expectedVersion must be a positive integer.", {
      field: "expectedVersion",
    });
  }
  return parsed;
}

/** POST bodies on action endpoints are optional; an absent body means "no options". */
async function parseOptionalBody<T extends { parse: (value: unknown) => unknown }>(
  c: { req: { text(): Promise<string> } },
  schema: T,
): Promise<{ expectedVersion?: number }> {
  const raw = await c.req.text();
  if (raw.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return schema.parse(parsed) as { expectedVersion?: number };
}
