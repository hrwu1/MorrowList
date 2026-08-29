import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "../context.js";

/** Liveness and readiness probes (FND-004, FND-006). Neither requires authentication. */
export function healthRoutes(deps: ApiDependencies) {
  return new Hono<ApiEnv>()
    .get("/health", (c) =>
      // Liveness: the process is up. Deliberately does not touch the database, so a
      // database outage does not cause the orchestrator to kill healthy processes.
      c.json({ status: "ok", requestId: c.get("requestId") }),
    )
    .get("/ready", async (c) => {
      const database = await deps.checkHealth();
      return c.json(
        {
          status: database.ok ? "ready" : "unavailable",
          checks: { database },
          requestId: c.get("requestId"),
        },
        database.ok ? 200 : 503,
      );
    });
}
