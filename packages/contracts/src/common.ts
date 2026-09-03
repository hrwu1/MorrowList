import { z } from "zod";

/**
 * Shared transport primitives (spec 20.1). These schemas describe the wire format only;
 * domain rules live in `@morrowlist/domain`.
 */

export const uuidSchema = z.uuid();

/** `YYYY-MM-DD`, no time and no zone (spec 12.3). */
export const plainDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be formatted as YYYY-MM-DD");

/** `HH:mm` wall-clock time (spec 12.3). */
export const plainTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be formatted as HH:mm");

export const timezoneSchema = z.string().min(1).max(100);

export const prioritySchema = z.enum(["none", "low", "medium", "high", "urgent"]);

export const statusCategorySchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
]);

export const actorKindSchema = z.enum([
  "user",
  "api_key",
  "system",
  "integration",
  "agent",
]);

export const actorSchema = z.object({
  kind: actorKindSchema,
  id: z.string(),
  displayName: z.string().nullable().optional(),
});

/** Error envelope from spec 20.2. Never carries a stack trace or SQL detail. */
export const errorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "AUTH_FORBIDDEN",
  "WORKSPACE_NOT_FOUND",
  "PROJECT_NOT_FOUND",
  "STATUS_NOT_FOUND",
  "TASK_NOT_FOUND",
  "VALIDATION_FAILED",
  "TASK_VERSION_CONFLICT",
  "TASK_INVALID_STATUS",
  "TASK_NESTING_LIMIT_EXCEEDED",
  "TASK_RELATION_CYCLE",
  "TASK_RELATION_NOT_FOUND",
  "TASK_BLOCKED",
  "STATUS_ARCHIVE_REQUIRES_DESTINATION",
  "TAG_NOT_FOUND",
  "TAG_NAME_CONFLICT",
  "STATUS_ARCHIVE_REQUIRES_REPLACEMENT",
  "WORKFLOW_INVARIANT_VIOLATED",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "INTERNAL_ERROR",
]);

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});

/** Cursor pagination (spec 20.6). Cursors are opaque; clients must not construct them. */
export const pageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), page: pageSchema });
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type StatusCategory = z.infer<typeof statusCategorySchema>;
export type ActorKind = z.infer<typeof actorKindSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type Page = z.infer<typeof pageSchema>;
