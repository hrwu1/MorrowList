import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  type Logger,
} from "@morrowlist/observability";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";
import { toErrorBody } from "../errors.js";

/**
 * Request identity, structured access logging, and the single place unhandled errors
 * become an error envelope (spec 17.3 steps 1 and 9).
 *
 * The log line records timing and outcome, never task content.
 */
export function requestContext(logger: Logger): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    const requestLogger = logger.child({ requestId });

    c.set("requestId", requestId);
    c.set("logger", requestLogger);
    c.header(REQUEST_ID_HEADER, requestId);

    const started = performance.now();
    try {
      await next();
    } catch (error) {
      const { status, body } = toErrorBody(error, requestId);
      // The full error stays server-side; the client receives only the envelope.
      requestLogger.error("request failed", {
        method: c.req.method,
        path: c.req.path,
        status,
        code: body.error.code,
        error,
      });
      return c.json(body, status);
    } finally {
      requestLogger.info("request completed", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      });
    }
    return undefined;
  };
}
