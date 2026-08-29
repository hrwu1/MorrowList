import { randomUUID } from "node:crypto";

/**
 * Request correlation (spec 17.3 step 1). An inbound `X-Request-Id` is honoured so a
 * caller can correlate across systems, but only when it is safe to echo back into logs.
 */

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "")}`;
}

/** Accept a client-supplied request ID only when it is short and alphanumeric. */
export function resolveRequestId(inbound: string | null | undefined): string {
  if (inbound && SAFE_REQUEST_ID.test(inbound)) return inbound;
  return newRequestId();
}
