import { ValidationError } from "../shared/errors.js";

import { addDays, toPlainDate, type PlainDate } from "./values.js";

/**
 * Recurrence rules (GAP-12, ADR pending-recurring-tasks).
 *
 * A rule describes when the next occurrence of a task falls due. It is deliberately a
 * small grammar — four frequencies with an interval, a weekday set, a day of month or an
 * nth weekday, and an end date or count — rather than RRULE: those cover the persona's
 * cases and keep `nextOccurrence` short enough to test exhaustively.
 *
 * The shape is canonical: every part a frequency does not use is `null`, so the stored
 * JSON, the contract, and the domain all compare the same value structurally.
 */

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** `schedule` anchors the next date at the due date; `after_completion` at the completion. */
export const RECURRENCE_MODES = ["schedule", "after_completion"] as const;
export type RecurrenceMode = (typeof RECURRENCE_MODES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Which weekday of the month: first to fourth, or `-1` for the last. */
export const NTH_WEEKS = [1, 2, 3, 4, -1] as const;
export type NthWeek = (typeof NTH_WEEKS)[number];

export const MAX_RECURRENCE_INTERVAL = 365;
export const MAX_RECURRENCE_COUNT = 1000;

export interface NthWeekday {
  readonly nth: NthWeek;
  readonly weekday: Weekday;
}

export interface RecurrenceRule {
  readonly freq: RecurrenceFrequency;
  /** Every N days, weeks, months, or years; at least 1. */
  readonly interval: number;
  readonly mode: RecurrenceMode;
  /** Weekly only: the weekdays an occurrence can fall on, in `WEEKDAYS` order. */
  readonly weekdays: readonly Weekday[] | null;
  /** Monthly only: day of month 1–31, clamped to the last day of shorter months. */
  readonly monthDay: number | null;
  /** Monthly only, instead of `monthDay`: e.g. the last Friday. */
  readonly nthWeekday: NthWeekday | null;
  /** No occurrence is created after this date. */
  readonly until: PlainDate | null;
  /** Occurrences left including the current one; `1` means this is the last. */
  readonly count: number | null;
}

/** The loosely shaped input a rule is built from: a request body or a parsed phrase. */
export interface RecurrenceRuleInput {
  readonly freq: RecurrenceFrequency;
  readonly interval?: number | null | undefined;
  readonly mode?: RecurrenceMode | null | undefined;
  readonly weekdays?: readonly Weekday[] | null | undefined;
  readonly monthDay?: number | null | undefined;
  readonly nthWeekday?: NthWeekday | null | undefined;
  readonly until?: string | null | undefined;
  readonly count?: number | null | undefined;
}

export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/** Validate and canonicalise a rule; throws `ValidationError` for an unusable one. */
export function toRecurrenceRule(input: RecurrenceRuleInput): RecurrenceRule {
  const field = "recurrence";
  if (!(RECURRENCE_FREQUENCIES as readonly string[]).includes(input.freq)) {
    throw new ValidationError("Recurrence frequency is not supported.", {
      field,
      freq: input.freq,
    });
  }
  const interval = input.interval ?? 1;
  if (
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > MAX_RECURRENCE_INTERVAL
  ) {
    throw new ValidationError(
      `Recurrence interval must be between 1 and ${MAX_RECURRENCE_INTERVAL}.`,
      { field, interval },
    );
  }
  const mode = input.mode ?? "schedule";
  if (!(RECURRENCE_MODES as readonly string[]).includes(mode)) {
    throw new ValidationError("Recurrence mode is not supported.", { field, mode });
  }

  let weekdays: readonly Weekday[] | null = null;
  let monthDay: number | null = null;
  let nthWeekday: NthWeekday | null = null;

  if (input.freq === "weekly") {
    const unique = WEEKDAYS.filter((day) => input.weekdays?.includes(day));
    if (unique.length === 0) {
      throw new ValidationError("A weekly rule needs at least one weekday.", {
        field,
      });
    }
    weekdays = unique;
  } else if (input.weekdays && input.weekdays.length > 0) {
    throw new ValidationError("Only a weekly rule can name weekdays.", { field });
  }

  if (input.freq === "monthly") {
    const hasDay = input.monthDay != null;
    const hasNth = input.nthWeekday != null;
    if (hasDay === hasNth) {
      throw new ValidationError(
        "A monthly rule needs a day of month or an nth weekday, not both.",
        { field },
      );
    }
    if (hasDay) {
      const day = input.monthDay as number;
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        throw new ValidationError("Day of month must be between 1 and 31.", {
          field,
          monthDay: day,
        });
      }
      monthDay = day;
    } else {
      const nth = input.nthWeekday as NthWeekday;
      if (
        !(NTH_WEEKS as readonly number[]).includes(nth.nth) ||
        !isWeekday(nth.weekday)
      ) {
        throw new ValidationError("The nth weekday is not valid.", { field });
      }
      nthWeekday = { nth: nth.nth, weekday: nth.weekday };
    }
  } else if (input.monthDay != null || input.nthWeekday != null) {
    throw new ValidationError("Only a monthly rule can name a day of the month.", {
      field,
    });
  }

  const until =
    input.until == null ? null : toPlainDate(input.until, "recurrence.until");
  const count = input.count ?? null;
  if (
    count !== null &&
    (!Number.isInteger(count) || count < 1 || count > MAX_RECURRENCE_COUNT)
  ) {
    throw new ValidationError(
      `Recurrence count must be between 1 and ${MAX_RECURRENCE_COUNT}.`,
      { field, count },
    );
  }

  return {
    freq: input.freq,
    interval,
    mode,
    weekdays,
    monthDay,
    nthWeekday,
    until,
    count,
  };
}

/** Structural equality; key order is irrelevant because JSONB does not preserve it. */
export function sameRecurrence(
  a: RecurrenceRule | null,
  b: RecurrenceRule | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.freq === b.freq &&
    a.interval === b.interval &&
    a.mode === b.mode &&
    a.monthDay === b.monthDay &&
    a.until === b.until &&
    a.count === b.count &&
    (a.weekdays?.join(",") ?? null) === (b.weekdays?.join(",") ?? null) &&
    a.nthWeekday?.nth === b.nthWeekday?.nth &&
    a.nthWeekday?.weekday === b.nthWeekday?.weekday
  );
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function partsOf(date: PlainDate): DateParts {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

function fromParts(year: number, month: number, day: number): PlainDate {
  return new Date(Date.UTC(year, month - 1, day))
    .toISOString()
    .slice(0, 10) as PlainDate;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 for Monday through 6 for Sunday, matching `WEEKDAYS`. */
function weekdayIndex(date: PlainDate): number {
  const { year, month, day } = partsOf(date);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** The weekday of a plain date, e.g. `"mon"`. */
export function weekdayOf(date: PlainDate): Weekday {
  return WEEKDAYS[weekdayIndex(date)] as Weekday;
}

function dayNumber(date: PlainDate): number {
  const { year, month, day } = partsOf(date);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The day of `nth` `weekday` in a month, e.g. the last Friday; clamped rules never miss. */
function nthWeekdayOfMonth(year: number, month: number, spec: NthWeekday): number {
  const target = WEEKDAYS.indexOf(spec.weekday);
  if (spec.nth === -1) {
    const last = daysInMonth(year, month);
    const lastWeekday = weekdayIndex(fromParts(year, month, last));
    return last - ((lastWeekday - target + 7) % 7);
  }
  const firstWeekday = weekdayIndex(fromParts(year, month, 1));
  return 1 + ((target - firstWeekday + 7) % 7) + 7 * (spec.nth - 1);
}

/**
 * The first date strictly after `from` that matches the rule, with the interval anchored
 * at `from`'s own day, week (Monday start), month, or year. `from` is an occurrence in
 * `schedule` mode and the completion date in `after_completion` mode; the arithmetic is
 * the same either way.
 */
export function nextOccurrence(rule: RecurrenceRule, from: PlainDate): PlainDate {
  const { year, month, day } = partsOf(from);

  switch (rule.freq) {
    case "daily":
      return addDays(from, rule.interval);

    case "weekly": {
      const allowed = new Set(rule.weekdays ?? []);
      const weekStart = dayNumber(from) - weekdayIndex(from);
      // A matching day exists within `interval` weeks plus the rest of this one.
      for (let offset = 1; offset <= 7 * rule.interval + 7; offset += 1) {
        const candidate = addDays(from, offset);
        const weeksAway = Math.floor((dayNumber(candidate) - weekStart) / 7);
        if (weeksAway % rule.interval === 0 && allowed.has(weekdayOf(candidate))) {
          return candidate;
        }
      }
      throw new Error("unreachable: a weekly rule always has a next weekday");
    }

    case "monthly": {
      for (let offset = 0; offset <= 12 * rule.interval + 12; offset += rule.interval) {
        const index = month - 1 + offset;
        const candidateYear = year + Math.floor(index / 12);
        const candidateMonth = (index % 12) + 1;
        const candidateDay =
          rule.nthWeekday !== null
            ? nthWeekdayOfMonth(candidateYear, candidateMonth, rule.nthWeekday)
            : Math.min(
                rule.monthDay ?? day,
                daysInMonth(candidateYear, candidateMonth),
              );
        const candidate = fromParts(candidateYear, candidateMonth, candidateDay);
        if (candidate > from) return candidate;
      }
      throw new Error("unreachable: a monthly rule always has a next month");
    }

    case "yearly": {
      const candidateYear = year + rule.interval;
      return fromParts(
        candidateYear,
        month,
        Math.min(day, daysInMonth(candidateYear, month)),
      );
    }
  }
}

export interface OccurrenceSource {
  readonly dueDate: PlainDate | null;
  readonly recurrence: RecurrenceRule | null;
}

export interface NextOccurrence {
  readonly dueDate: PlainDate;
  /** The rule the new occurrence carries: the same one, with `count` decremented. */
  readonly recurrence: RecurrenceRule;
}

/**
 * The occurrence that follows a task completed (or skipped) on `on`, or null when the
 * task does not repeat or its series is exhausted. In `schedule` mode the next date is
 * anchored at the due date and then moved past `on`, so a late completion never yields an
 * occurrence that is already overdue; in `after_completion` mode it is anchored at `on`.
 */
export function nextOccurrenceAfter(
  source: OccurrenceSource,
  on: PlainDate,
): NextOccurrence | null {
  const rule = source.recurrence;
  if (rule === null) return null;
  if (rule.count !== null && rule.count <= 1) return null;

  let dueDate = nextOccurrence(
    rule,
    rule.mode === "schedule" ? (source.dueDate ?? on) : on,
  );
  while (dueDate <= on) dueDate = nextOccurrence(rule, dueDate);

  if (rule.until !== null && dueDate > rule.until) return null;

  return {
    dueDate,
    recurrence: rule.count === null ? rule : { ...rule, count: rule.count - 1 },
  };
}

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

const NTH_LABELS: Record<NthWeek, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};

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

/** A short human label, e.g. "Every 2 weeks on Mon, Thu after completion, until 2026-12-31". */
export function describeRecurrence(rule: RecurrenceRule): string {
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

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  mon: "mon",
  monday: "mon",
  tue: "tue",
  tues: "tue",
  tuesday: "tue",
  wed: "wed",
  weds: "wed",
  wednesday: "wed",
  thu: "thu",
  thur: "thu",
  thurs: "thu",
  thursday: "thu",
  fri: "fri",
  friday: "fri",
  sat: "sat",
  saturday: "sat",
  sun: "sun",
  sunday: "sun",
};

const NTH_ALIASES: Record<string, NthWeek> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  last: -1,
};

const UNIT_FREQUENCIES: Record<string, RecurrenceFrequency> = {
  day: "daily",
  days: "daily",
  daily: "daily",
  week: "weekly",
  weeks: "weekly",
  weekly: "weekly",
  month: "monthly",
  months: "monthly",
  monthly: "monthly",
  year: "yearly",
  years: "yearly",
  yearly: "yearly",
  annually: "yearly",
};

export interface RecurrencePhraseOptions {
  /** Weekday a bare weekly phrase defaults to; usually the due date's, else today's. */
  readonly defaultWeekday: Weekday;
  /** Day of month a bare monthly phrase defaults to. */
  readonly defaultMonthDay: number;
  readonly mode?: RecurrenceMode | undefined;
}

/**
 * Parse the `every …` phrase the CLI takes and GAP-15's quick add will share, e.g.
 * `day`, `2 weeks on mon,thu`, `weekdays`, `month on 31`, `month on last fri`, `year`,
 * `week until 2026-12-31`, `day for 10 times`. Returns null for anything it does not
 * understand rather than guessing.
 */
export function parseRecurrencePhrase(
  phrase: string,
  options: RecurrencePhraseOptions,
): RecurrenceRule | null {
  const tokens = phrase
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && token !== "every");
  if (tokens.length === 0) return null;

  let until: string | null = null;
  let count: number | null = null;
  // Trailing bounds: `until <date>` and `[for] N times`.
  const untilAt = tokens.indexOf("until");
  if (untilAt !== -1) {
    const date = tokens[untilAt + 1];
    if (!date || tokens.length !== untilAt + 2) return null;
    until = date;
    tokens.splice(untilAt);
  }
  const timesAt = tokens.indexOf("times");
  if (timesAt !== -1) {
    const number = Number(tokens[timesAt - 1]);
    const forAt = tokens[timesAt - 2] === "for" ? timesAt - 2 : timesAt - 1;
    if (!Number.isInteger(number) || tokens.length !== timesAt + 1) return null;
    count = number;
    tokens.splice(forAt);
  }
  if (tokens.length === 0) return null;

  let interval = 1;
  if (/^\d+$/.test(tokens[0] as string)) {
    interval = Number(tokens.shift());
  }
  const unit = tokens.shift() as string;
  const mode = options.mode ?? "schedule";

  if (unit === "weekday" || unit === "weekdays") {
    if (tokens.length > 0) return null;
    return build({
      freq: "weekly",
      interval,
      mode,
      weekdays: ["mon", "tue", "wed", "thu", "fri"],
      until,
      count,
    });
  }
  const weekdayAlone = WEEKDAY_ALIASES[unit] ?? WEEKDAY_ALIASES[unit.replace(/s$/, "")];
  if (weekdayAlone && tokens.length === 0) {
    // `every monday`, `every 2 mondays` are weekly rules on that day.
    return build({
      freq: "weekly",
      interval,
      mode,
      weekdays: [weekdayAlone],
      until,
      count,
    });
  }
  const freq = UNIT_FREQUENCIES[unit] ?? UNIT_FREQUENCIES[unit.replace(/s$/, "")];
  if (!freq) return null;

  if (tokens[0] === "on") tokens.shift();
  else if (tokens.length > 0) return null;

  if (freq === "weekly") {
    const weekdays =
      tokens.length === 0
        ? [options.defaultWeekday]
        : tokens.map((t) => WEEKDAY_ALIASES[t]);
    if (weekdays.some((day) => day === undefined)) return null;
    return build({
      freq,
      interval,
      mode,
      weekdays: weekdays as Weekday[],
      until,
      count,
    });
  }
  if (freq === "monthly") {
    if (tokens.length === 0) {
      return build({
        freq,
        interval,
        mode,
        monthDay: options.defaultMonthDay,
        until,
        count,
      });
    }
    if (tokens.length === 1) {
      const day = Number((tokens[0] as string).replace(/(st|nd|rd|th)$/, ""));
      if (!Number.isInteger(day)) return null;
      return build({ freq, interval, mode, monthDay: day, until, count });
    }
    if (tokens.length === 2) {
      const nth = NTH_ALIASES[tokens[0] as string];
      const weekday = WEEKDAY_ALIASES[tokens[1] as string];
      if (nth === undefined || weekday === undefined) return null;
      return build({
        freq,
        interval,
        mode,
        nthWeekday: { nth, weekday },
        until,
        count,
      });
    }
    return null;
  }
  if (tokens.length > 0) return null;
  return build({ freq, interval, mode, until, count });
}

function build(input: RecurrenceRuleInput): RecurrenceRule | null {
  try {
    return toRecurrenceRule(input);
  } catch {
    return null;
  }
}
