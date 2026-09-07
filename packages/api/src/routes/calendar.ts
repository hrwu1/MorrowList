import { calendarViewQuerySchema } from "@morrowlist/contracts";
import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";
import { parseQuery } from "../middleware/validate.js";

import { requireWorkspace } from "./workspace.js";

export function calendarRoutes(deps: ApiDependencies) {
  // Bounded process-local limiter: no IP trust assumptions, no stored raw bearer tokens.
  let windowStart = 0;
  let reads = 0;
  return new Hono<ApiEnv>()
    .get("/views/calendar", async (c) => {
      const actor = c.get("actor");
      return c.json(
        await deps.viewService.calendar(actor, {
          ...parseQuery(c.req.query(), calendarViewQuerySchema),
          workspaceId: requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        }),
      );
    })
    .get("/me/calendar-feed", async (c) => {
      const actor = c.get("actor");
      c.header("Cache-Control", "no-store");
      return c.json({
        data: await deps.calendarFeedService.status(
          actor,
          requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
        ),
      });
    })
    .post("/me/calendar-feed", async (c) => {
      const actor = c.get("actor");
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          data: await deps.calendarFeedService.create(
            actor,
            requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
          ),
        },
        201,
      );
    })
    .delete("/me/calendar-feed", async (c) => {
      const actor = c.get("actor");
      await deps.calendarFeedService.revoke(
        actor,
        requireWorkspace(c.req.query("workspaceId"), actor.workspaceIds),
      );
      c.header("Cache-Control", "no-store");
      return c.body(null, 204);
    })
    .get("/feeds/:file", async (c) => {
      c.header("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
      c.header("Referrer-Policy", "no-referrer");
      const now = Date.now();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        reads = 0;
      }
      if (++reads > 120) {
        c.header("Retry-After", "60");
        return c.text("Too many calendar feed requests.", 429);
      }
      const file = c.req.param("file");
      const body = file.endsWith(".ics")
        ? await deps.calendarFeedService.feed(file.slice(0, -4))
        : null;
      if (body === null) return c.text("Calendar feed not found.", 404);
      c.header("Content-Type", "text/calendar; charset=utf-8");
      c.header("Content-Disposition", 'inline; filename="morrowlist.ics"');
      return c.body(body);
    });
}
