import { describe, expect, it } from "vitest";

import {
  CUSTOM_REPEAT,
  NO_REPEAT,
  describeRecurrence,
  presetIdFor,
  recurrencePresets,
  sameRule,
  weekdayOf,
} from "./recurrence";

describe("describeRecurrence", () => {
  const base = {
    interval: 1,
    mode: "schedule" as const,
    weekdays: null,
    monthDay: null,
    nthWeekday: null,
    until: null,
    count: null,
  };

  // The same table as the domain's test, so the two labels cannot drift apart.
  it.each([
    [{ ...base, freq: "daily" as const }, "Every day"],
    [{ ...base, freq: "daily" as const, interval: 3 }, "Every 3 days"],
    [
      { ...base, freq: "weekly" as const, weekdays: ["mon", "thu"] },
      "Every week on Mon, Thu",
    ],
    [
      {
        ...base,
        freq: "weekly" as const,
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
      },
      "Every week on weekdays",
    ],
    [
      {
        ...base,
        freq: "weekly" as const,
        interval: 2,
        weekdays: ["fri"],
        mode: "after_completion" as const,
      },
      "Every 2 weeks on Fri after completion",
    ],
    [{ ...base, freq: "monthly" as const, monthDay: 31 }, "Every month on the 31st"],
    [{ ...base, freq: "monthly" as const, monthDay: 22 }, "Every month on the 22nd"],
    [{ ...base, freq: "monthly" as const, monthDay: 13 }, "Every month on the 13th"],
    [
      { ...base, freq: "monthly" as const, nthWeekday: { nth: -1, weekday: "fri" } },
      "Every month on the last Friday",
    ],
    [
      {
        ...base,
        freq: "monthly" as const,
        interval: 6,
        nthWeekday: { nth: 2, weekday: "tue" },
      },
      "Every 6 months on the second Tuesday",
    ],
    [
      { ...base, freq: "yearly" as const, until: "2030-01-01" },
      "Every year, until 2030-01-01",
    ],
    [{ ...base, freq: "daily" as const, count: 1 }, "Every day, 1 occurrence left"],
    [{ ...base, freq: "daily" as const, count: 4 }, "Every day, 4 occurrences left"],
  ])("%j reads as %s", (rule, expected) => {
    expect(describeRecurrence(rule as never)).toBe(expected);
  });
});

describe("weekdayOf", () => {
  it("names the day, Monday first", () => {
    expect(weekdayOf("2026-09-03")).toBe("thu");
    expect(weekdayOf("2026-09-06")).toBe("sun");
    expect(weekdayOf("2026-09-07")).toBe("mon");
  });
});

describe("recurrencePresets", () => {
  it("anchors the weekly and monthly presets at the given date", () => {
    const presets = recurrencePresets("2026-09-03");
    expect(presets.map((preset) => [preset.id, preset.label])).toEqual([
      ["daily", "Every day"],
      ["weekly", "Every week on Thu"],
      ["weekdays", "Every weekday"],
      ["monthly", "Every month on the 3rd"],
      ["yearly", "Every year"],
    ]);
    expect(presets[1]?.rule.weekdays).toEqual(["thu"]);
    expect(presets[3]?.rule.monthDay).toBe(3);
  });
});

describe("presetIdFor", () => {
  it("recognises a preset, no rule, and anything else as custom", () => {
    const [daily, weekly] = recurrencePresets("2026-09-03");
    expect(presetIdFor(null, "2026-09-03")).toBe(NO_REPEAT);
    expect(presetIdFor(daily!.rule, "2026-09-03")).toBe("daily");
    expect(presetIdFor(weekly!.rule, "2026-09-03")).toBe("weekly");
    // The same weekly rule anchored at a Monday is no longer the Thursday preset.
    expect(presetIdFor(weekly!.rule, "2026-09-07")).toBe(CUSTOM_REPEAT);
    expect(presetIdFor({ ...daily!.rule, interval: 2 }, "2026-09-03")).toBe(
      CUSTOM_REPEAT,
    );
  });
});

describe("sameRule", () => {
  it("compares every part of the rule", () => {
    const [, , , monthly] = recurrencePresets("2026-09-03");
    expect(sameRule(monthly!.rule, { ...monthly!.rule })).toBe(true);
    expect(sameRule(monthly!.rule, { ...monthly!.rule, count: 2 })).toBe(false);
    expect(
      sameRule(monthly!.rule, {
        ...monthly!.rule,
        monthDay: null,
        nthWeekday: { nth: 1, weekday: "thu" },
      }),
    ).toBe(false);
    expect(sameRule(null, null)).toBe(true);
    expect(sameRule(monthly!.rule, null)).toBe(false);
  });
});
