import { describe, expect, it } from "vitest";

import {
  deriveSigningKey,
  generateWebhookSecret,
  parseSignature,
  secretPrefix,
  signPayload,
  verifySignature,
} from "./signature.js";

const BODY = JSON.stringify({ type: "task.completed" });
const NOW = 1_800_000_000;

describe("webhook secrets", () => {
  it("generates a recognisable secret and stores only a one-way digest", () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(secret.length).toBeGreaterThan(30);

    const key = deriveSigningKey(secret);
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
    expect(key).not.toContain(secret.slice(6));
    // Two secrets never collide onto one key, and the same secret always derives the same.
    expect(deriveSigningKey(secret)).toBe(key);
    expect(deriveSigningKey(generateWebhookSecret())).not.toBe(key);
  });

  it("shows a prefix short enough to be safe and long enough to tell endpoints apart", () => {
    const secret = generateWebhookSecret();
    expect(secretPrefix(secret)).toBe(secret.slice(0, 14));
    expect(secret.startsWith(secretPrefix(secret))).toBe(true);
  });
});

describe("signPayload", () => {
  it("emits the documented t=/v1= header over `<t>.<body>`", () => {
    const header = signPayload(deriveSigningKey("whsec_test"), BODY, NOW);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(parseSignature(header)).toEqual({
      timestamp: NOW,
      value: header.slice(header.indexOf("v1=") + 3),
    });
  });

  it("changes when the body, the timestamp, or the key changes", () => {
    const key = deriveSigningKey("whsec_test");
    const base = signPayload(key, BODY, NOW);
    expect(signPayload(key, `${BODY} `, NOW)).not.toBe(base);
    expect(signPayload(key, BODY, NOW + 1)).not.toBe(base);
    expect(signPayload(deriveSigningKey("whsec_other"), BODY, NOW)).not.toBe(base);
  });
});

describe("verifySignature", () => {
  const secret = "whsec_the-subscribers-copy";
  const header = signPayload(deriveSigningKey(secret), BODY, NOW);

  it("accepts a delivery signed with the secret the subscriber holds", () => {
    expect(verifySignature(secret, BODY, header, NOW)).toBe(true);
    expect(verifySignature(secret, BODY, header, NOW + 299)).toBe(true);
  });

  it("rejects a replay outside the window even though the HMAC is valid", () => {
    expect(verifySignature(secret, BODY, header, NOW + 301)).toBe(false);
    expect(verifySignature(secret, BODY, header, NOW - 301)).toBe(false);
  });

  it("rejects a tampered body, a tampered timestamp, and the wrong secret", () => {
    expect(verifySignature(secret, `${BODY} `, header, NOW)).toBe(false);
    expect(
      verifySignature(secret, BODY, header.replace(`t=${NOW}`, `t=${NOW + 1}`), NOW),
    ).toBe(false);
    expect(verifySignature("whsec_wrong", BODY, header, NOW)).toBe(false);
  });

  it("rejects a malformed header rather than throwing", () => {
    expect(parseSignature("nonsense")).toBeNull();
    expect(verifySignature(secret, BODY, "nonsense", NOW)).toBe(false);
    expect(verifySignature(secret, BODY, "t=abc,v1=zz", NOW)).toBe(false);
    expect(verifySignature(secret, BODY, `t=${NOW},v1=deadbeef`, NOW)).toBe(false);
  });
});
