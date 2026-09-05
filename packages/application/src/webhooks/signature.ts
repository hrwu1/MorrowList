import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { WEBHOOK_REPLAY_WINDOW_SECONDS } from "@morrowlist/contracts";

/**
 * Delivery signing (GAP-18).
 *
 * A subscriber is shown a secret once. The server keeps only its SHA-256 digest and signs
 * with that digest, so a database read cannot recover the string the user was given — and
 * the subscriber can still verify, because they hold the secret and can hash it
 * themselves. `docs/api/webhooks.md` carries the receiver-side snippet.
 *
 * Nothing in this file may be logged: `secret`, `signingKey`, and the signature itself are
 * all credentials (spec 27.1).
 */

/** `whsec_` + 32 random bytes, base64url. Recognisable in a config file at a glance. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** The stored signing key. One-way: the secret cannot be recovered from it. */
export function deriveSigningKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** What a read of the subscription shows instead of the secret. */
export function secretPrefix(secret: string): string {
  return secret.slice(0, 14);
}

export interface SignatureParts {
  /** Unix seconds, the `t=` field. */
  readonly timestamp: number;
  readonly value: string;
}

/**
 * `t=<unix>,v1=<hex hmac>` over `<t>.<raw body>`. The timestamp is inside the signed
 * string, so it cannot be edited to widen the replay window.
 */
export function signPayload(
  signingKey: string,
  body: string,
  timestamp: number,
): string {
  const digest = createHmac("sha256", Buffer.from(signingKey, "hex"))
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function parseSignature(header: string): SignatureParts | null {
  const fields = new Map(
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([key, value]) => [key, value] as const),
  );
  const timestamp = Number(fields.get("t"));
  const value = fields.get("v1");
  if (!Number.isFinite(timestamp) || !value) return null;
  return { timestamp, value };
}

/**
 * Receiver-side verification, kept next to the sender so the two cannot drift. The
 * integration tests and the documented snippet both go through it.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number,
  windowSeconds: number = WEBHOOK_REPLAY_WINDOW_SECONDS,
): boolean {
  const parsed = parseSignature(header);
  if (!parsed) return false;
  // A replayed delivery is rejected on age before the HMAC is even compared.
  if (Math.abs(nowSeconds - parsed.timestamp) > windowSeconds) return false;

  const expected = parseSignature(
    signPayload(deriveSigningKey(secret), body, parsed.timestamp),
  );
  if (!expected) return false;

  const a = Buffer.from(parsed.value, "hex");
  const b = Buffer.from(expected.value, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
