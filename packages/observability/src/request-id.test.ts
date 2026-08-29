import { describe, expect, it } from "vitest";

import { newRequestId, resolveRequestId } from "./request-id.js";

describe("resolveRequestId", () => {
  it("generates an ID when none is supplied", () => {
    expect(resolveRequestId(null)).toMatch(/^req_[0-9a-f]{32}$/);
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });

  it("honours a safe inbound ID", () => {
    expect(resolveRequestId("trace-abc-123456")).toBe("trace-abc-123456");
  });

  it("replaces an unsafe inbound ID", () => {
    // Log-injection and oversized values must not be echoed into structured logs.
    expect(resolveRequestId("short")).toMatch(/^req_/);
    expect(resolveRequestId("bad\nvalue\ninjected")).toMatch(/^req_/);
    expect(resolveRequestId("x".repeat(200))).toMatch(/^req_/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));

    expect(ids.size).toBe(500);
  });
});
