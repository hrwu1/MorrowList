import { updateWorkspaceRequestSchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { parseJsonBody } from "../middleware/validate.js";

/** Resolve the implied personal workspace without hardcoding a single-workspace model. */
export function requireWorkspace(
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

/** Workspace settings (spec 20.3 `PATCH /workspaces/{id}`, GAP-20). */
export function workspaceRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>().patch("/workspaces/:id", async (c) => {
    const actor = c.get("actor");
    const body = await parseJsonBody(c, updateWorkspaceRequestSchema);
    const workspace = await deps.workspaceService.update(
      actor,
      c.req.param("id"),
      body,
    );
    return c.json({ data: workspace });
  });
}
