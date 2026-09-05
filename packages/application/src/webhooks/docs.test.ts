import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { toEnvelope } from "./sender.js";
import { deriveSigningKey, signPayload } from "./signature.js";

/**
 * The verification snippet in `docs/api/webhooks.md` is executed here against a real
 * delivery (GAP-18 completion criterion).
 *
 * Documentation that is only read drifts. This test extracts the published snippet from
 * the markdown, runs it, and fails if a subscriber following the documentation would
 * reject a delivery MorrowList actually sends — or accept one it should not.
 */

const DOC_PATH = resolve(import.meta.dirname, "../../../../docs/api/webhooks.md");

/** Pull the first fenced ```js block out of the document. */
function publishedSnippet(): string {
  const markdown = readFileSync(DOC_PATH, "utf8");
  const match = /```js\n([\s\S]*?)```/.exec(markdown);
  if (!match?.[1]) throw new Error("no js snippet found in docs/api/webhooks.md");
  return match[1];
}

/**
 * Run the snippet as written, with its `node:crypto` import satisfied by the real module
 * rather than rewritten: the only edit is turning the ESM import into a binding, because
 * `new Function` has no module scope.
 */
function loadVerifier(now: number) {
  const source = publishedSnippet()
    .replace(/^import .*?;\n/m, "")
    .replace(/^export function/m, "function");

  const factory = new Function(
    "createHash",
    "createHmac",
    "timingSafeEqual",
    "Date",
    `${source}\nreturn verifyMorrowSignature;`,
  ) as (
    hash: typeof createHash,
    hmac: typeof createHmac,
    equal: typeof timingSafeEqual,
    clock: { now: () => number },
  ) => (secret: string, rawBody: string, header: string) => boolean;

  return factory(createHash, createHmac, timingSafeEqual, {
    now: () => now * 1000,
  });
}

const SECRET = "whsec_a-subscriber-copy-of-the-secret";
const NOW = new Date("2026-09-05T09:00:00.000Z");
const TIMESTAMP = Math.floor(NOW.getTime() / 1000);

/** A delivery built exactly as the dispatcher builds one. */
function realDelivery() {
  const envelope = toEnvelope(
    {
      id: "01996c5d-0000-7000-8000-00000000000a",
      schemaVersion: 1,
      eventType: "task.updated",
      aggregateType: "task",
      aggregateId: "01996c1f-0000-7000-8000-000000000001",
      workspaceId: "01996b00-0000-7000-8000-000000000002",
      actor: { kind: "user", id: "01996a00-0000-7000-8000-000000000003" },
      payload: { taskId: "01996c1f-0000-7000-8000-000000000001" },
      correlationId: "req_docs",
      occurredAt: NOW,
    },
    {
      id: "01996c5e-0000-7000-8000-00000000000b",
      subscriptionId: "01996c5f-0000-7000-8000-00000000000c",
    },
    1,
  );
  const body = JSON.stringify(envelope);
  return { body, header: signPayload(deriveSigningKey(SECRET), body, TIMESTAMP) };
}

describe("the verification snippet published in docs/api/webhooks.md", () => {
  it("accepts a delivery MorrowList really sends", () => {
    const verify = loadVerifier(TIMESTAMP);
    const { body, header } = realDelivery();
    expect(verify(SECRET, body, header)).toBe(true);
  });

  it("rejects a tampered body, the wrong secret, and a replay", () => {
    const { body, header } = realDelivery();

    const verify = loadVerifier(TIMESTAMP);
    expect(verify(SECRET, `${body} `, header)).toBe(false);
    expect(verify("whsec_not-the-secret", body, header)).toBe(false);
    expect(verify(SECRET, body, "garbage")).toBe(false);

    // Five minutes and one second later the same delivery is refused as a replay.
    const late = loadVerifier(TIMESTAMP + 301);
    expect(late(SECRET, body, header)).toBe(false);
    expect(loadVerifier(TIMESTAMP + 299)(SECRET, body, header)).toBe(true);
  });
});
