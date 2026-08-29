/**
 * Log redaction (spec 26.3, 27.1). Two rules apply:
 *
 * 1. Secrets are never logged, in any environment.
 * 2. Task content — titles, descriptions, tag names — is not logged by default, because
 *    logs are operational telemetry and a user's task list is private.
 */

const SECRET_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
  "setcookie",
  "sessiontoken",
  "clientsecret",
  "authsecret",
  "databaseurl",
  "connectionstring",
]);

const CONTENT_KEYS = new Set([
  "title",
  "description",
  "descriptionmd",
  "summary",
  "name",
  "email",
  "notes",
  "payload",
]);

export const REDACTED = "[redacted]";

export interface RedactOptions {
  /** Include task content. Off by default; enable only for explicit debugging. */
  readonly includeContent?: boolean;
  readonly maxDepth?: number;
}

/**
 * Deep-redact a value for logging. Returns a new structure; the input is never mutated.
 * Cyclic references are replaced with `[circular]` rather than throwing.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  return walk(value, options, options.maxDepth ?? 6, new WeakSet());
}

function walk(
  value: unknown,
  options: RedactOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "[truncated]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, options, depth - 1, seen));
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, "");
    if (SECRET_KEYS.has(normalized)) {
      out[key] = REDACTED;
    } else if (!options.includeContent && CONTENT_KEYS.has(normalized)) {
      out[key] = REDACTED;
    } else {
      out[key] = walk(entry, options, depth - 1, seen);
    }
  }
  return out;
}
