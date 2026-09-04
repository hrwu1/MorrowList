/**
 * Domain errors carry a stable machine-readable code from the spec's error catalogue
 * (section 20.2). Transports map the code to an HTTP status; the domain never knows
 * about HTTP.
 */
export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "TASK_NOT_FOUND"
  | "TASK_VERSION_CONFLICT"
  | "TASK_INVALID_STATUS"
  | "TASK_NESTING_LIMIT_EXCEEDED"
  | "TASK_RELATION_CYCLE"
  | "TASK_RELATION_NOT_FOUND"
  | "TASK_BLOCKED"
  | "PROJECT_NOT_FOUND"
  | "STATUS_NOT_FOUND"
  | "STATUS_ARCHIVE_REQUIRES_DESTINATION"
  | "TAG_NOT_FOUND"
  | "TAG_NAME_CONFLICT"
  | "STATUS_ARCHIVE_REQUIRES_REPLACEMENT"
  | "WORKFLOW_INVARIANT_VIOLATED"
  | "VERSION_CONFLICT"
  | "SAVED_VIEW_NOT_FOUND"
  | "SAVED_VIEW_NAME_CONFLICT"
  | "WORKSPACE_NOT_FOUND"
  | "AUTH_FORBIDDEN";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super("VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

export class VersionConflictError extends DomainError {
  constructor(taskId: string, expectedVersion: number, actualVersion: number) {
    super("TASK_VERSION_CONFLICT", "The task changed after you loaded it.", {
      taskId,
      expectedVersion,
      actualVersion,
    });
    this.name = "VersionConflictError";
  }
}
