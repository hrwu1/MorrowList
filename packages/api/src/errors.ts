import type { ErrorCode } from "@morrowlist/contracts";
import { DomainError } from "@morrowlist/domain";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Error mapping (spec 20.2). The domain raises a stable code; the transport chooses the
 * HTTP status. No stack trace, SQL text, or internal message reaches a client.
 */

const STATUS_BY_CODE: Record<ErrorCode, ContentfulStatusCode> = {
  AUTH_REQUIRED: 401,
  AUTH_FORBIDDEN: 403,
  WORKSPACE_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  STATUS_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  TASK_VERSION_CONFLICT: 409,
  TASK_INVALID_STATUS: 422,
  TASK_NESTING_LIMIT_EXCEEDED: 422,
  TASK_RELATION_CYCLE: 422,
  STATUS_ARCHIVE_REQUIRES_DESTINATION: 409,
  TAG_NOT_FOUND: 404,
  TAG_NAME_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function statusFor(code: ErrorCode): ContentfulStatusCode {
  return STATUS_BY_CODE[code] ?? 500;
}

export function toErrorBody(
  error: unknown,
  requestId: string,
): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof ApiError) {
    return {
      status: statusFor(error.code),
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          requestId,
        },
      },
    };
  }

  if (error instanceof DomainError) {
    const code = error.code as ErrorCode;
    return {
      status: statusFor(code),
      body: {
        error: {
          code,
          message: error.message,
          ...(Object.keys(error.details).length > 0
            ? { details: error.details as Record<string, unknown> }
            : {}),
          requestId,
        },
      },
    };
  }

  // Anything unrecognised is reported as an opaque internal error. The real cause is
  // logged server-side with the same request ID.
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
        requestId,
      },
    },
  };
}
