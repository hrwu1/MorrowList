import {
  createWebhookRequestSchema,
  listWebhookDeliveriesQuerySchema,
  paginationQuerySchema,
  updateWebhookRequestSchema,
} from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseJsonBody, parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

/**
 * Webhook subscriptions and their delivery log (GAP-18, spec 18.4). One use case per
 * route; the secret is returned by `POST /webhooks` and by nothing else.
 */
export function webhookRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/webhooks", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), paginationQuerySchema);
      return c.json(
        await deps.webhookService.list(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          query,
        ),
      );
    })

    .post("/webhooks", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, createWebhookRequestSchema);
      const created = await deps.webhookService.create(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        body,
      );
      return c.json({ data: created }, 201);
    })

    .patch("/webhooks/:id", async (c) => {
      const actor = c.get("actor");
      const body = await parseJsonBody(c, updateWebhookRequestSchema);
      return c.json({
        data: await deps.webhookService.update(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          body,
        ),
      });
    })

    .delete("/webhooks/:id", async (c) => {
      const actor = c.get("actor");
      await deps.webhookService.delete(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        c.req.param("id"),
      );
      return c.body(null, 204);
    })

    .post("/webhooks/:id/test", async (c) => {
      const actor = c.get("actor");
      // Answers 200 with the recorded outcome even when the endpoint refused it: the
      // point of a test is to report what happened, not to fail the request.
      return c.json({
        data: await deps.webhookService.test(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
        ),
      });
    })

    .get("/webhooks/:id/deliveries", async (c) => {
      const actor = c.get("actor");
      const query = parseQuery(c.req.query(), listWebhookDeliveriesQuerySchema);
      return c.json(
        await deps.webhookService.listDeliveries(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          query,
        ),
      );
    })

    .post("/webhooks/:id/deliveries/:deliveryId/retry", async (c) => {
      const actor = c.get("actor");
      return c.json({
        data: await deps.webhookService.retryDelivery(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          c.req.param("id"),
          c.req.param("deliveryId"),
        ),
      });
    });
}
