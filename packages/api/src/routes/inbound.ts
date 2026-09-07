import { parseInboundEmail } from "@morrowlist/application";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";

import { requireWorkspace } from "./workspace.js";

export function inboundRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/capture/address", async (c) => {
      const actor = c.get("actor");
      c.header("Cache-Control", "private, no-store");
      return c.json({
        data: await deps.inboundEmailService.getAddress(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      });
    })
    .post("/capture/address/rotate", async (c) => {
      const actor = c.get("actor");
      c.header("Cache-Control", "private, no-store");
      return c.json({
        data: await deps.inboundEmailService.rotateAddress(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      });
    })
    .post("/inbound/email", async (c) => {
      deps.inboundEmailService.authorize(c.req.header("authorization"));
      const provider = c.req.query("provider") ?? "normalized";
      let body: unknown;
      try {
        body = c.req.header("content-type")?.includes("application/json")
          ? await c.req.json()
          : await c.req.parseBody();
      } catch {
        throw new ApiError("VALIDATION_FAILED", "Invalid email request body.");
      }
      const result = await deps.inboundEmailService.receive(
        provider,
        parseInboundEmail(provider, body),
        c.get("requestId"),
      );
      return c.json({ data: result }, result.duplicate ? 200 : 201);
    });
}
