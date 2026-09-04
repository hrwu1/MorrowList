import { describe, expect, it } from "vitest";

import { deadlineTone, isDeferred } from "./task-dates";

describe("isDeferred", () => {
  it("is true only while the defer date is ahead of the view's date", () => {
    expect(isDeferred({ deferUntil: "2026-09-10" }, "2026-09-09")).toBe(true);
    expect(isDeferred({ deferUntil: "2026-09-10" }, "2026-09-10")).toBe(false);
    expect(isDeferred({ deferUntil: null }, "2026-09-09")).toBe(false);
  });
});

describe("deadlineTone", () => {
  it("is loud for a past deadline and for the next two days, plain beyond", () => {
    expect(deadlineTone("2026-09-02", "2026-09-03")).toBe("past");
    expect(deadlineTone("2026-09-03", "2026-09-03")).toBe("soon");
    expect(deadlineTone("2026-09-05", "2026-09-03")).toBe("soon");
    expect(deadlineTone("2026-09-06", "2026-09-03")).toBe("later");
  });
});
