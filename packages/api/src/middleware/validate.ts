import type { MiddlewareHandler } from "hono";
import type { z } from "zod";

import type { ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";

/**
 * Zod validation at the transport boundary (spec 17.3 step 4). A failure is reported as
 * VALIDATION_FAILED with per-field detail, never as an unhandled exception.
 */

export async function parseJsonBody<T extends z.ZodType>(
  c: { req: { json(): Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return parseWith(schema, raw);
}

export function parseQuery<T extends z.ZodType>(
  query: Record<string, string | string[] | undefined>,
  schema: T,
): z.infer<T> {
  return parseWith(schema, query);
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", "The request could not be validated.", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Rejects an oversized body before it is parsed (spec 26.1). */
export function bodyLimit(maxBytes: number): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const declared = c.req.header("content-length");
    if (declared && Number(declared) > maxBytes) {
      throw new ApiError("VALIDATION_FAILED", "Request body is too large.", {
        maxBytes,
      });
    }
    await next();
  };
}
