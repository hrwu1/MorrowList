import type { TaskDto } from "@morrowlist/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  BULK_LIMIT,
  assertBulkConfirmed,
  formatBulkPlan,
  formatBulkResult,
  recurrenceFromPhrase,
} from "./shared.js";

describe("recurrenceFromPhrase", () => {
  it("anchors a bare week or month at the due date", () => {
    expect(recurrenceFromPhrase("week", "2026-09-03", false, false)).toMatchObject({
      freq: "weekly",
      weekdays: ["thu"],
      mode: "schedule",
    });
    expect(recurrenceFromPhrase("month", "2026-09-30", true, false)).toMatchObject({
      freq: "monthly",
      monthDay: 30,
      mode: "after_completion",
    });
  });

  it("passes an explicit phrase through canonicalised", () => {
    expect(recurrenceFromPhrase("2 weeks on thu,mon", null, false, false)).toEqual({
      freq: "weekly",
      interval: 2,
      mode: "schedule",
      weekdays: ["mon", "thu"],
      monthDay: null,
      nthWeekday: null,
      until: null,
      count: null,
    });
  });
});

describe("bulk guards (GAP-08)", () => {
  const task = (key: string, title: string) =>
    ({ key, title, id: key, version: 1 }) as unknown as TaskDto;

  it("lists a dry run and reports what a batch applied", () => {
    const tasks = [task("ML-1", "Draft"), task("ML-2", "Review")];
    expect(formatBulkPlan("completed", tasks)).toBe(
      ["Would completed 2 tasks:", "  ML-1  Draft", "  ML-2  Review"].join("\n"),
    );
    expect(
      formatBulkResult("trashed", [
        { op: "delete", taskId: "ML-1", data: tasks[0]! },
        { op: "delete", taskId: "ML-2", data: tasks[1]! },
      ]),
    ).toBe(["ML-1  trashed", "ML-2  trashed", "2 tasks trashed."].join("\n"));
  });

  it("refuses an unconfirmed, empty, or oversized selection", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const one = [task("ML-1", "Draft")];

    // Nothing matched: a bulk command that silently does nothing is worse than an error.
    expect(() => assertBulkConfirmed([], { where: "x" }, false)).toThrow("exit");
    // Matched, but not confirmed.
    expect(() => assertBulkConfirmed(one, { where: "x" }, false)).toThrow("exit");
    // More than one transaction can hold.
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => task(`ML-${i}`, "x"));
    expect(() => assertBulkConfirmed(many, { where: "x", yes: true }, false)).toThrow(
      "exit",
    );

    // Confirmed, and a dry run, both pass without exiting.
    expect(() =>
      assertBulkConfirmed(one, { where: "x", yes: true }, false),
    ).not.toThrow();
    expect(() =>
      assertBulkConfirmed(one, { where: "x", dryRun: true }, false),
    ).not.toThrow();

    exit.mockRestore();
    stderr.mockRestore();
  });
});
