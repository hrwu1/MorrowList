import { describe, expect, it } from "vitest";

import { ValidationError } from "../shared/errors.js";

import {
  describeRecurrence,
  nextOccurrence,
  nextOccurrenceAfter,
  parseRecurrencePhrase,
  sameRecurrence,
  toRecurrenceRule,
  weekdayOf,
  type RecurrenceRule,
  type RecurrenceRuleInput,
} from "./recurrence.js";
import type { PlainDate } from "./values.js";

const date = (value: string) => value as PlainDate;
const rule = (input: RecurrenceRuleInput): RecurrenceRule => toRecurrenceRule(input);

describe("toRecurrenceRule", () => {
  it("canonicalises a rule with nulls for the parts a frequency does not use", () => {
    expect(rule({ freq: "daily" })).toEqual({
      freq: "daily",
      interval: 1,
      mode: "schedule",
      weekdays: null,
      monthDay: null,
      nthWeekday: null,
      until: null,
      count: null,
    });
  });

  it("orders and de-duplicates weekdays", () => {
    expect(rule({ freq: "weekly", weekdays: ["fri", "mon", "fri"] }).weekdays).toEqual([
      "mon",
      "fri",
    ]);
  });

  it.each<[string, RecurrenceRuleInput]>([
    ["an unknown frequency", { freq: "hourly" as never }],
    ["a zero interval", { freq: "daily", interval: 0 }],
    ["a fractional interval", { freq: "daily", interval: 1.5 }],
    ["an interval over a year", { freq: "daily", interval: 366 }],
    ["a weekly rule without weekdays", { freq: "weekly", weekdays: [] }],
    ["weekdays on a daily rule", { freq: "daily", weekdays: ["mon"] }],
    ["a monthly rule without a day", { freq: "monthly" }],
    [
      "a monthly rule with both day forms",
      { freq: "monthly", monthDay: 1, nthWeekday: { nth: 1, weekday: "mon" } },
    ],
    ["day 0 of the month", { freq: "monthly", monthDay: 0 }],
    ["day 32 of the month", { freq: "monthly", monthDay: 32 }],
    [
      "a fifth weekday",
      { freq: "monthly", nthWeekday: { nth: 5 as never, weekday: "mon" } },
    ],
    ["a month day on a yearly rule", { freq: "yearly", monthDay: 3 }],
    ["a count of zero", { freq: "daily", count: 0 }],
    ["an impossible end date", { freq: "daily", until: "2026-02-30" }],
    ["an unknown mode", { freq: "daily", mode: "whenever" as never }],
  ])("rejects %s", (_label, input) => {
    expect(() => toRecurrenceRule(input)).toThrow(ValidationError);
  });
});

describe("nextOccurrence", () => {
  it.each<[string, RecurrenceRuleInput, string, string]>([
    ["daily", { freq: "daily" }, "2026-09-03", "2026-09-04"],
    [
      "every 3 days across a month end",
      { freq: "daily", interval: 3 },
      "2026-09-29",
      "2026-10-02",
    ],
    ["daily across a leap day", { freq: "daily" }, "2028-02-28", "2028-02-29"],
    ["daily across a year end", { freq: "daily" }, "2026-12-31", "2027-01-01"],

    [
      "weekly on the same weekday",
      { freq: "weekly", weekdays: ["thu"] },
      "2026-09-03",
      "2026-09-10",
    ],
    [
      "weekly set: later in the same week",
      { freq: "weekly", weekdays: ["mon", "thu"] },
      "2026-09-07",
      "2026-09-10",
    ],
    [
      "weekly set: wraps to the next week",
      { freq: "weekly", weekdays: ["mon", "thu"] },
      "2026-09-10",
      "2026-09-14",
    ],
    [
      "weekly from a day not in the set",
      { freq: "weekly", weekdays: ["mon"] },
      "2026-09-02",
      "2026-09-07",
    ],
    [
      "every 2 weeks skips the week between",
      { freq: "weekly", interval: 2, weekdays: ["thu"] },
      "2026-09-03",
      "2026-09-17",
    ],
    [
      "every 2 weeks on mon,thu: Thursday of the same week still counts",
      { freq: "weekly", interval: 2, weekdays: ["mon", "thu"] },
      "2026-09-07",
      "2026-09-10",
    ],
    [
      "every 2 weeks on mon,thu: Monday two weeks on",
      { freq: "weekly", interval: 2, weekdays: ["mon", "thu"] },
      "2026-09-10",
      "2026-09-21",
    ],
    [
      "weekly on Sunday from a Sunday uses Monday-start weeks",
      { freq: "weekly", interval: 2, weekdays: ["sun"] },
      "2026-09-06",
      "2026-09-20",
    ],
    [
      "weekdays only skip the weekend",
      { freq: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
      "2026-09-04",
      "2026-09-07",
    ],

    [
      "monthly on the 15th",
      { freq: "monthly", monthDay: 15 },
      "2026-09-15",
      "2026-10-15",
    ],
    [
      "monthly on the 15th from earlier in the month",
      { freq: "monthly", monthDay: 15 },
      "2026-09-03",
      "2026-09-15",
    ],
    [
      "monthly on the 31st clamps to the 30th",
      { freq: "monthly", monthDay: 31 },
      "2026-08-31",
      "2026-09-30",
    ],
    [
      "monthly on the 31st springs back to the 31st",
      { freq: "monthly", monthDay: 31 },
      "2026-09-30",
      "2026-10-31",
    ],
    [
      "monthly on the 31st in February",
      { freq: "monthly", monthDay: 31 },
      "2027-01-31",
      "2027-02-28",
    ],
    [
      "monthly on the 29th in a leap February",
      { freq: "monthly", monthDay: 29 },
      "2028-01-29",
      "2028-02-29",
    ],
    [
      "monthly on the 30th in a leap February clamps",
      { freq: "monthly", monthDay: 30 },
      "2028-01-30",
      "2028-02-29",
    ],
    [
      "every 3 months across a year end",
      { freq: "monthly", interval: 3, monthDay: 1 },
      "2026-11-01",
      "2027-02-01",
    ],
    [
      "every 2 months anchored at from's month",
      { freq: "monthly", interval: 2, monthDay: 20 },
      "2026-09-25",
      "2026-11-20",
    ],
    [
      "monthly on the first Monday",
      { freq: "monthly", nthWeekday: { nth: 1, weekday: "mon" } },
      "2026-09-07",
      "2026-10-05",
    ],
    [
      "monthly on the first Monday later this month",
      { freq: "monthly", nthWeekday: { nth: 1, weekday: "mon" } },
      "2026-10-01",
      "2026-10-05",
    ],
    [
      "monthly on the last Friday",
      { freq: "monthly", nthWeekday: { nth: -1, weekday: "fri" } },
      "2026-09-25",
      "2026-10-30",
    ],
    [
      "monthly on the fourth Thursday",
      { freq: "monthly", nthWeekday: { nth: 4, weekday: "thu" } },
      "2026-10-22",
      "2026-11-26",
    ],
    [
      "monthly on the last day of February via the 31st",
      { freq: "monthly", monthDay: 31 },
      "2028-01-31",
      "2028-02-29",
    ],

    ["yearly", { freq: "yearly" }, "2026-09-03", "2027-09-03"],
    [
      "yearly from 29 February clamps to the 28th",
      { freq: "yearly" },
      "2028-02-29",
      "2029-02-28",
    ],
    [
      "every 4 years from 29 February keeps the day",
      { freq: "yearly", interval: 4 },
      "2028-02-29",
      "2032-02-29",
    ],
  ])("%s", (_label, input, from, expected) => {
    expect(nextOccurrence(rule(input), date(from))).toBe(expected);
  });

  it("always returns a date strictly after the anchor", () => {
    const rules: RecurrenceRuleInput[] = [
      { freq: "daily" },
      { freq: "weekly", weekdays: ["mon", "wed", "sun"], interval: 3 },
      { freq: "monthly", monthDay: 31 },
      { freq: "monthly", nthWeekday: { nth: -1, weekday: "sun" }, interval: 2 },
      { freq: "yearly" },
    ];
    for (const input of rules) {
      let from = date("2026-01-31");
      for (let step = 0; step < 40; step += 1) {
        const next = nextOccurrence(rule(input), from);
        expect(next > from).toBe(true);
        from = next;
      }
    }
  });
});

describe("nextOccurrenceAfter", () => {
  it("anchors at the due date in schedule mode", () => {
    const source = {
      dueDate: date("2026-09-03"),
      recurrence: rule({ freq: "weekly", weekdays: ["thu"] }),
    };
    expect(nextOccurrenceAfter(source, date("2026-09-03"))?.dueDate).toBe("2026-09-10");
  });

  it("moves past a late completion so the next occurrence is not already overdue", () => {
    const daily = { dueDate: date("2026-08-20"), recurrence: rule({ freq: "daily" }) };
    expect(nextOccurrenceAfter(daily, date("2026-09-03"))?.dueDate).toBe("2026-09-04");

    const fortnightly = {
      dueDate: date("2026-08-06"),
      recurrence: rule({ freq: "weekly", interval: 2, weekdays: ["thu"] }),
    };
    // The cadence stays anchored at the original Thursday: 20 Aug, 3 Sep, then 17 Sep.
    expect(nextOccurrenceAfter(fortnightly, date("2026-09-03"))?.dueDate).toBe(
      "2026-09-17",
    );
  });

  it("anchors at the completion date in after_completion mode", () => {
    const source = {
      dueDate: date("2026-08-01"),
      recurrence: rule({ freq: "monthly", monthDay: 1, mode: "after_completion" }),
    };
    expect(nextOccurrenceAfter(source, date("2026-09-03"))?.dueDate).toBe("2026-10-01");
  });

  it("uses the completion date when a scheduled task has no due date", () => {
    const source = { dueDate: null, recurrence: rule({ freq: "daily" }) };
    expect(nextOccurrenceAfter(source, date("2026-09-03"))?.dueDate).toBe("2026-09-04");
  });

  it("counts down and ends on the last occurrence", () => {
    const three = {
      dueDate: date("2026-09-03"),
      recurrence: rule({ freq: "daily", count: 3 }),
    };
    const second = nextOccurrenceAfter(three, date("2026-09-03"));
    expect(second).toEqual({
      dueDate: "2026-09-04",
      recurrence: { ...three.recurrence, count: 2 },
    });

    const last = nextOccurrenceAfter(
      { dueDate: second?.dueDate ?? null, recurrence: second?.recurrence ?? null },
      date("2026-09-04"),
    );
    expect(last?.recurrence.count).toBe(1);
    expect(
      nextOccurrenceAfter(
        { dueDate: last?.dueDate ?? null, recurrence: last?.recurrence ?? null },
        date("2026-09-05"),
      ),
    ).toBeNull();
  });

  it("ends when the next date passes the end date", () => {
    const source = {
      dueDate: date("2026-09-03"),
      recurrence: rule({ freq: "weekly", weekdays: ["thu"], until: "2026-09-10" }),
    };
    expect(nextOccurrenceAfter(source, date("2026-09-03"))?.dueDate).toBe("2026-09-10");
    expect(
      nextOccurrenceAfter(
        { dueDate: date("2026-09-10"), recurrence: source.recurrence },
        date("2026-09-10"),
      ),
    ).toBeNull();
  });

  it("returns null for a task that does not repeat", () => {
    expect(
      nextOccurrenceAfter(
        { dueDate: date("2026-09-03"), recurrence: null },
        date("2026-09-03"),
      ),
    ).toBeNull();
  });
});

describe("sameRecurrence", () => {
  it("compares structurally, ignoring key order", () => {
    const a = rule({ freq: "weekly", weekdays: ["mon", "thu"], count: 3 });
    const b = {
      count: 3,
      until: null,
      nthWeekday: null,
      monthDay: null,
      weekdays: ["mon", "thu"],
      mode: "schedule",
      interval: 1,
      freq: "weekly",
    } as RecurrenceRule;
    expect(sameRecurrence(a, b)).toBe(true);
    expect(sameRecurrence(a, { ...b, count: 2 })).toBe(false);
    expect(sameRecurrence(a, null)).toBe(false);
    expect(sameRecurrence(null, null)).toBe(true);
  });
});

describe("describeRecurrence", () => {
  it.each<[RecurrenceRuleInput, string]>([
    [{ freq: "daily" }, "Every day"],
    [{ freq: "daily", interval: 3 }, "Every 3 days"],
    [{ freq: "weekly", weekdays: ["thu", "mon"] }, "Every week on Mon, Thu"],
    [
      { freq: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] },
      "Every week on weekdays",
    ],
    [
      { freq: "weekly", interval: 2, weekdays: ["fri"], mode: "after_completion" },
      "Every 2 weeks on Fri after completion",
    ],
    [{ freq: "monthly", monthDay: 31 }, "Every month on the 31st"],
    [{ freq: "monthly", monthDay: 22 }, "Every month on the 22nd"],
    [{ freq: "monthly", monthDay: 13 }, "Every month on the 13th"],
    [
      { freq: "monthly", nthWeekday: { nth: -1, weekday: "fri" } },
      "Every month on the last Friday",
    ],
    [
      { freq: "monthly", interval: 6, nthWeekday: { nth: 2, weekday: "tue" } },
      "Every 6 months on the second Tuesday",
    ],
    [{ freq: "yearly", until: "2030-01-01" }, "Every year, until 2030-01-01"],
    [{ freq: "daily", count: 1 }, "Every day, 1 occurrence left"],
    [{ freq: "daily", count: 4 }, "Every day, 4 occurrences left"],
  ])("%j reads as %s", (input, expected) => {
    expect(describeRecurrence(rule(input))).toBe(expected);
  });
});

describe("parseRecurrencePhrase", () => {
  const options = { defaultWeekday: "thu" as const, defaultMonthDay: 3 };

  it.each<[string, RecurrenceRuleInput]>([
    ["day", { freq: "daily" }],
    ["every day", { freq: "daily" }],
    ["daily", { freq: "daily" }],
    ["2 days", { freq: "daily", interval: 2 }],
    ["week", { freq: "weekly", weekdays: ["thu"] }],
    ["weekly", { freq: "weekly", weekdays: ["thu"] }],
    ["2 weeks on mon,thu", { freq: "weekly", interval: 2, weekdays: ["mon", "thu"] }],
    [
      "2 weeks on Monday Thursday",
      { freq: "weekly", interval: 2, weekdays: ["mon", "thu"] },
    ],
    ["monday", { freq: "weekly", weekdays: ["mon"] }],
    ["every 2 fridays", { freq: "weekly", interval: 2, weekdays: ["fri"] }],
    ["weekday", { freq: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] }],
    ["weekdays", { freq: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] }],
    ["month", { freq: "monthly", monthDay: 3 }],
    ["month on 1", { freq: "monthly", monthDay: 1 }],
    ["month on 31st", { freq: "monthly", monthDay: 31 }],
    ["3 months on 15", { freq: "monthly", interval: 3, monthDay: 15 }],
    ["month on last fri", { freq: "monthly", nthWeekday: { nth: -1, weekday: "fri" } }],
    [
      "month on 2nd tuesday",
      { freq: "monthly", nthWeekday: { nth: 2, weekday: "tue" } },
    ],
    ["year", { freq: "yearly" }],
    ["annually", { freq: "yearly" }],
    ["2 years", { freq: "yearly", interval: 2 }],
    [
      "week until 2026-12-31",
      { freq: "weekly", weekdays: ["thu"], until: "2026-12-31" },
    ],
    ["day for 10 times", { freq: "daily", count: 10 }],
    ["day 10 times", { freq: "daily", count: 10 }],
    [
      "2 weeks on fri until 2027-01-01",
      { freq: "weekly", interval: 2, weekdays: ["fri"], until: "2027-01-01" },
    ],
  ])("parses %s", (phrase, expected) => {
    expect(parseRecurrencePhrase(phrase, options)).toEqual(rule(expected));
  });

  it("applies the requested mode", () => {
    expect(
      parseRecurrencePhrase("week", { ...options, mode: "after_completion" })?.mode,
    ).toBe("after_completion");
  });

  it.each([
    "",
    "fortnight",
    "0 days",
    "week on funday",
    "month on 32",
    "month on fifth mon",
    "month on 1 2 3",
    "year on 3",
    "day until",
    "day until 2026-13-01",
    "day for x times",
    "every",
  ])("rejects %j", (phrase) => {
    expect(parseRecurrencePhrase(phrase, options)).toBeNull();
  });
});

describe("weekdayOf", () => {
  it("names the day", () => {
    expect(weekdayOf(date("2026-09-03"))).toBe("thu");
    expect(weekdayOf(date("2026-09-06"))).toBe("sun");
    expect(weekdayOf(date("2026-09-07"))).toBe("mon");
  });
});
