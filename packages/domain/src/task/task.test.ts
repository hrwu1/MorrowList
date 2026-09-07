import { describe, expect, it } from "vitest";

import { parseTaskKey, taskKey, taskNumberRef } from "./task.js";

describe("taskKey", () => {
  it("pads the number so keys line up in a list", () => {
    expect(taskKey("ML", 1)).toBe("ML-000001");
    expect(taskKey("ML", 142)).toBe("ML-000142");
    expect(taskKey("ML", 999_999)).toBe("ML-999999");
  });

  it("grows a digit past the padded width rather than truncating", () => {
    expect(taskKey("ML", 1_000_000)).toBe("ML-1000000");
  });

  it("keeps the prefix exactly as the workspace wrote it", () => {
    expect(taskKey("MorrowList", 42)).toBe("MorrowList-000042");
  });
});

describe("taskNumberRef", () => {
  it("names a task without a prefix, so a rename cannot make it stale", () => {
    expect(taskNumberRef(143)).toBe("#000143");
  });
});

describe("parseTaskKey", () => {
  it("reads a padded key and a bare one as the same number", () => {
    expect(parseTaskKey("ML-000042")?.taskNumber).toBe(42);
    expect(parseTaskKey("ML-42")?.taskNumber).toBe(42);
  });

  it("accepts a prefix of up to 24 characters in any case, as written", () => {
    expect(parseTaskKey("MorrowList-000042")?.prefix).toBe("MorrowList");
    expect(parseTaskKey("ml-000042")?.prefix).toBe("ml");
    expect(parseTaskKey(`${"a".repeat(24)}-1`)?.prefix).toBe("a".repeat(24));
    expect(parseTaskKey(`${"a".repeat(25)}-1`)).toBeNull();
  });

  it("returns null for anything that is not a key", () => {
    // A UUID is the other way a task is addressed, and must not read as a key — including
    // one whose first group starts with a letter, now that a prefix may be 24 long.
    expect(parseTaskKey("01a07dec-7783-7003-bca4-21b06a2688ab")).toBeNull();
    expect(parseTaskKey("abc07dec-7783-7003-bca4-21b06a2688ab")).toBeNull();
    expect(parseTaskKey("1ML-42")).toBeNull();
    expect(parseTaskKey("ML-0")).toBeNull();
    expect(parseTaskKey("ML-")).toBeNull();
    expect(parseTaskKey("ML")).toBeNull();
  });

  it("round-trips what taskKey renders", () => {
    const parsed = parseTaskKey(taskKey("MorrowList", 7));
    expect(parsed).toEqual({ prefix: "MorrowList", taskNumber: 7 });
  });
});
