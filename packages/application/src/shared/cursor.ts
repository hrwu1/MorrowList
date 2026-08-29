import { createHmac, timingSafeEqual } from "node:crypto";

import { DomainError } from "@morrowlist/domain";

/**
 * Opaque, signed pagination cursors (spec 20.6). Clients must not construct them, so the
 * payload is signed: a tampered cursor is rejected rather than silently changing the
 * query. The cursor carries only an ordering position, never a filter.
 */

export interface CursorPayload {
  /** The sort key of the last item on the previous page. */
  readonly k: string;
  /** The id of that item, breaking ties on a non-unique sort key. */
  readonly i: string;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function decodeCursor(cursor: string, secret: string): CursorPayload {
  const [body, signature] = cursor.split(".");
  if (!body || !signature) {
    throw new DomainError("VALIDATION_FAILED", "Malformed pagination cursor.");
  }

  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new DomainError("VALIDATION_FAILED", "Invalid pagination cursor.");
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as CursorPayload;
    if (typeof parsed.k !== "string" || typeof parsed.i !== "string") {
      throw new Error("shape");
    }
    return parsed;
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Invalid pagination cursor.");
  }
}
