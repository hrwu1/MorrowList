import { Hono } from "hono";

import type { ApiDependencies, ApiEnv } from "./context.js";
import { ApiError, toErrorBody } from "./errors.js";
import { authenticate } from "./middleware/authenticate.js";
import { requestContext } from "./middleware/request-context.js";
import { bodyLimit } from "./middleware/validate.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { projectRoutes } from "./routes/projects.js";
import { tagRoutes } from "./routes/tags.js";
import { taskRoutes } from "./routes/tasks.js";
import { viewRoutes } from "./routes/views.js";

/**
 * The `/api/v1` application (FND-006). Mounted inside Next.js today; the same Hono app can
 * move to a standalone Node service without touching the application layer (ADR-003).
 */

export const API_BASE_PATH = "/api/v1";
const MAX_BODY_BYTES = 1_000_000;

export function createApiApp(deps: ApiDependencies) {
  const app = new Hono<ApiEnv>().basePath(API_BASE_PATH);

  app.use("*", requestContext(deps.logger));
  app.use("*", bodyLimit(MAX_BODY_BYTES));

  // Probes stay unauthenticated so an orchestrator can reach them.
  app.route("/", healthRoutes(deps));

  const listWorkspaceIds = async (userId: string): Promise<readonly string[]> => {
    const workspaces = await deps.unitOfWork.execute((tx) =>
      tx.workspaces.listForUser(userId),
    );
    return workspaces.map((workspace) => workspace.id);
  };

  app.use("/me", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tasks", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tasks/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/projects", authenticate(deps.auth, listWorkspaceIds));
  app.use("/projects/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/views/*", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tags", authenticate(deps.auth, listWorkspaceIds));
  app.use("/tags/*", authenticate(deps.auth, listWorkspaceIds));

  app.route("/", meRoutes(deps));
  app.route("/", projectRoutes(deps));
  app.route("/", tagRoutes(deps));
  app.route("/", taskRoutes(deps));
  app.route("/", viewRoutes(deps));

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
