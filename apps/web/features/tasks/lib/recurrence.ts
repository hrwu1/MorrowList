import type { RecurrenceRuleDto } from "@morrowlist/contracts";

/**
 * Presentation helpers for recurrence (GAP-12). The rule grammar lives in the domain,
 * which the browser bundle cannot import (it reaches for `node:crypto`), so the label
 * and the weekday lookup are mirrored here the way `PRIORITIES` is in `task-view.ts`;
 * the unit test pins the wording to the domain's.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const NTH_WEEKS = [1, 2, 3, 4, -1] as const;

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const NTH_LABELS: Record<(typeof NTH_WEEKS)[number], string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

/** The weekday of a `YYYY-MM-DD` date, e.g. `"thu"`; Monday-first like the domain. */
export function weekdayOf(date: string): Weekday {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const index = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return WEEKDAYS[index] as Weekday;
}

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** The same wording as the domain's `describeRecurrence`, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRecurrence(rule: RecurrenceRuleDto): string {
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[
    rule.freq
  ];
  const every =
    rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;

  let when = "";
  if (rule.freq === "weekly" && rule.weekdays) {
    when =
      rule.weekdays.length === 5 &&
      !rule.weekdays.includes("sat") &&
      !rule.weekdays.includes("sun")
        ? " on weekdays"
        : ` on ${rule.weekdays.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
  } else if (rule.freq === "monthly" && rule.monthDay !== null) {
    when = ` on the ${ordinal(rule.monthDay)}`;
  } else if (rule.freq === "monthly" && rule.nthWeekday !== null) {
    when = ` on the ${NTH_LABELS[rule.nthWeekday.nth]} ${WEEKDAY_NAMES[rule.nthWeekday.weekday]}`;
  }

  const mode = rule.mode === "after_completion" ? " after completion" : "";
  const end =
    rule.until !== null
      ? `, until ${rule.until}`
      : rule.count !== null
        ? `, ${rule.count} ${rule.count === 1 ? "occurrence" : "occurrences"} left`
        : "";
  return `${every}${when}${mode}${end}`;
}

export interface RecurrencePreset {
  readonly id: string;
  readonly label: string;
  readonly rule: RecurrenceRuleDto;
}

export const NO_REPEAT = "none";
export const CUSTOM_REPEAT = "custom";

const WEEKDAYS_ONLY = ["mon", "tue", "wed", "thu", "fri"] as const;

function rule(
  overrides: Partial<RecurrenceRuleDto> & { freq: RecurrenceRuleDto["freq"] },
): RecurrenceRuleDto {
  return {
    interval: 1,
    mode: "schedule",
    weekdays: null,
    monthDay: null,
    nthWeekday: null,
    until: null,
    count: null,
    ...overrides,
  };
}

/** The presets for a task, anchored at its due date (or today when it has none). */
export function recurrencePresets(anchor: string): RecurrencePreset[] {
  const weekday = weekdayOf(anchor);
  const monthDay = Number(anchor.slice(8, 10));
  return [
    { id: "daily", label: "Every day", rule: rule({ freq: "daily" }) },
    {
      id: "weekly",
      label: describeRecurrence(rule({ freq: "weekly", weekdays: [weekday] })),
      rule: rule({ freq: "weekly", weekdays: [weekday] }),
    },
    {
      id: "weekdays",
      label: "Every weekday",
      rule: rule({ freq: "weekly", weekdays: [...WEEKDAYS_ONLY] }),
    },
    {
      id: "monthly",
      label: describeRecurrence(rule({ freq: "monthly", monthDay })),
      rule: rule({ freq: "monthly", monthDay }),
    },
    { id: "yearly", label: "Every year", rule: rule({ freq: "yearly" }) },
  ];
}

/** Structural equality on the canonical shape; the wire format never reorders arrays. */
export function sameRule(
  a: RecurrenceRuleDto | null,
  b: RecurrenceRuleDto | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.freq === b.freq &&
    a.interval === b.interval &&
    a.mode === b.mode &&
    a.monthDay === b.monthDay &&
    a.until === b.until &&
    a.count === b.count &&
    (a.weekdays?.join() ?? "") === (b.weekdays?.join() ?? "") &&
    a.nthWeekday?.nth === b.nthWeekday?.nth &&
    a.nthWeekday?.weekday === b.nthWeekday?.weekday
  );
}

/** Which preset a stored rule is, `NO_REPEAT` for none, or `CUSTOM_REPEAT` otherwise. */
export function presetIdFor(value: RecurrenceRuleDto | null, anchor: string): string {
  if (value === null) return NO_REPEAT;
  return (
    recurrencePresets(anchor).find((preset) => sameRule(preset.rule, value))?.id ??
    CUSTOM_REPEAT
  );
}
