import { describe, expect, it } from "vitest";

import { recurrenceFromPhrase } from "./shared.js";

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
