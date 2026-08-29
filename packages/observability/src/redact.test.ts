import { describe, expect, it } from "vitest";

import { REDACTED, redact } from "./redact.js";

describe("redact", () => {
  it("removes secrets", () => {
    const result = redact({
      password: "hunter2",
      apiKey: "ml_live_abc",
      authorization: "Bearer x",
      DATABASE_URL: "postgres://user:pw@host/db",
      keep: "visible",
    }) as Record<string, unknown>;

    expect(result.password).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.authorization).toBe(REDACTED);
    expect(result.DATABASE_URL).toBe(REDACTED);
    expect(result.keep).toBe("visible");
  });

  it("omits task content by default", () => {
    const result = redact({ taskId: "t1", title: "Buy a gift" }) as Record<
      string,
      unknown
    >;

    expect(result.taskId).toBe("t1");
    expect(result.title).toBe(REDACTED);
  });

  it("includes content when explicitly requested", () => {
    const result = redact(
      { title: "Buy a gift", password: "hunter2" },
      { includeContent: true },
    ) as Record<string, unknown>;

    expect(result.title).toBe("Buy a gift");
    // Secrets stay redacted even then.
    expect(result.password).toBe(REDACTED);
  });

  it("walks nested structures", () => {
    const result = redact({
      request: { headers: { cookie: "session=1" }, tasks: [{ title: "x", id: "1" }] },
    }) as any;

    expect(result.request.headers.cookie).toBe(REDACTED);
    expect(result.request.tasks[0].title).toBe(REDACTED);
    expect(result.request.tasks[0].id).toBe("1");
  });

  it("handles cycles without throwing", () => {
    const cyclic: Record<string, unknown> = { id: "1" };
    cyclic.self = cyclic;

    expect(redact(cyclic)).toEqual({ id: "1", self: "[circular]" });
  });

  it("serializes dates and errors", () => {
    const result = redact({
      at: new Date("2026-08-29T00:00:00.000Z"),
      failure: new Error("boom"),
    }) as any;

    expect(result.at).toBe("2026-08-29T00:00:00.000Z");
    expect(result.failure).toEqual({ name: "Error", message: "boom" });
  });
});
