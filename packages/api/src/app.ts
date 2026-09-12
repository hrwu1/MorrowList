import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "./context.js";
import { ApiError, toErrorBody } from "./errors.js";
import { authenticate } from "./middleware/authenticate.js";
import { idempotency } from "./middleware/idempotency.js";
import { requestContext } from "./middleware/request-context.js";
import { bodyLimit } from "./middleware/validate.js";
import { calendarRoutes } from "./routes/calendar.js";
import { exportRoutes } from "./routes/exports.js";
import { fieldRoutes } from "./routes/fields.js";
import { healthRoutes } from "./routes/health.js";
import { importRoutes } from "./routes/imports.js";
import { inboundRoutes } from "./routes/inbound.js";
import { meRoutes } from "./routes/me.js";
import { notificationRoutes } from "./routes/notifications.js";
import { projectRoutes } from "./routes/projects.js";
import { ruleRoutes } from "./routes/rules.js";
import { searchRoutes } from "./routes/search.js";
import { statusRoutes } from "./routes/statuses.js";
import { tagRoutes } from "./routes/tags.js";
import { taskRoutes } from "./routes/tasks.js";
import { viewRoutes } from "./routes/views.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { workspaceRoutes } from "./routes/workspace.js";

/**
 * The `/api/v1` application (FND-006). Mounted inside Next.js today; the same Hono app can
 * move to a standalone Node service without touching the application layer (ADR-003).
 */

export const API_BASE_PATH = "/api/v1";
const MAX_BODY_BYTES = 1_000_000;
/** An import carries a whole exported board or spreadsheet, so it gets its own cap. */
const MAX_IMPORT_BODY_BYTES = 10_000_000;

export function createApiApp(deps: ApiDependencies) {
  const app = new Hono<ApiEnv>().basePath(API_BASE_PATH);

  app.use("*", requestContext(deps.logger));
  app.use(
    "*",
    bodyLimit((path) =>
      path.startsWith(`${API_BASE_PATH}/imports`)
        ? MAX_IMPORT_BODY_BYTES
        : MAX_BODY_BYTES,
    ),
  );

  // Probes stay unauthenticated so an orchestrator can reach them.
  app.route("/", healthRoutes(deps));

  const listWorkspaceIds = async (userId: string): Promise<readonly string[]> => {
    const workspaces = await deps.unitOfWork.execute((tx) =>
      tx.workspaces.listForUser(userId),
    );
    return workspaces.map((workspace) => workspace.id);
  };

  app.use("/capture/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/me", authenticate(deps.auth, listWorkspaceIds));
  app.use("/me/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/notifications", authenticate(deps.auth, listWorkspaceIds));
  app.use("/notifications/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tasks", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tasks/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/projects", authenticate(deps.auth, listWorkspaceIds));
  app.use("/projects/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/views/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/search", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tags", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tags/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/fields", authenticate(deps.auth, listWorkspaceIds));
  app.use("/fields/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/statuses/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/rules", authenticate(deps.auth, listWorkspaceIds));
  app.use("/rules/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/webhooks", authenticate(deps.auth, listWorkspaceIds));
  app.use("/webhooks/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/workspaces/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/exports/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/imports/*", authenticate(deps.auth, listWorkspaceIds));

  app.use("*", idempotency(deps.idempotencyService, deps.idempotencySecret));

  app.route("/", calendarRoutes(deps));
  app.route("/", inboundRoutes(deps));
  app.route("/", exportRoutes(deps));
  app.route("/", importRoutes(deps));
  app.route("/", meRoutes(deps));
  app.route("/", notificationRoutes(deps));
  app.route("/", projectRoutes(deps));
  app.route("/", statusRoutes(deps));
  app.route("/", searchRoutes(deps));
  app.route("/", fieldRoutes(deps));
  app.route("/", tagRoutes(deps));
  app.route("/", taskRoutes(deps));
  app.route("/", viewRoutes(deps));
  app.route("/", webhookRoutes(deps));
  app.route("/", ruleRoutes(deps));
  app.route("/", workspaceRoutes(deps));

  app.notFound((c) => {
    const { status, body } = toErrorBody(
      new ApiError("NOT_FOUND", "No such endpoint."),
      c.get("requestId") ?? "unknown",
    );
    return c.json(body, status);
  });

  app.onError((error, c) => {
    const { status, body } = toErrorBody(error, c.get("requestId") ?? "unknown");
    return c.json(body, status);
  });

  return app;
}

export type ApiApp = ReturnType<typeof createApiApp>;
