import { parseSearchQuery } from "../search/query.js";
import { MAX_TAGS_PER_TASK } from "../tag/tag.js";

import {
  WEEKDAYS,
  describeRecurrence,
  parseRecurrencePhrase,
  weekdayOf,
  type RecurrenceRule,
  type Weekday,
} from "./recurrence.js";
import {
  addDays,
  toPlainDate,
  toPlainTime,
  type PlainDate,
  type PlainTime,
  type Priority,
} from "./values.js";

/**
 * Natural-language capture (GAP-15, ADR pending-natural-language-capture).
 *
 * `parseCapture` turns one line of typed text into the fields a create-task request
 * carries, plus the character spans each field was read from, so a client can draw chips
 * over the very text the user typed. It is pure, deterministic and shared: the web quick
 * add and `morrow task add` call this one function, so a phrase means the same thing in
 * both. `CAPTURE_EXAMPLES` at the foot of this file is the fixture all three suites run.
 *
 * ## The grammar
 *
 * Everything is matched on whole whitespace-separated tokens, lower-cased, with one
 * trailing comma or semicolon ignored. A double-quoted run counts as one token, so
 * `#"Q3 launch"` and `tag:"deep work"` work.
 *
 *   dates       today, tomorrow, tmr, next week, <weekday>, next <weekday>, in N days,
 *               in N weeks, 2026-09-20, jan 5, jan 5 2029, 20 sep, september 20th
 *   times       5pm, 5:30pm, 17:00, noon, midnight, optionally preceded by `at`
 *   explicit    due <date|time>, defer|start|starting [until] <date>,
 *               deadline <date> [<time>], due by <date> (a deadline, not a plan)
 *   priority    p1..p4 (urgent, high, medium, low), !! (high), !!! (urgent),
 *               and the search grammar's own `priority:<name>`
 *   project     #name, #"quoted name"
 *   tags        @name, @"quoted name", and the search grammar's `tag:<name>`
 *   repeat      every <phrase>, in the `parseRecurrencePhrase` grammar (GAP-12)
 *   literal     a leading backslash keeps a token as text: `\#12`, `\tomorrow`
 *
 * ## The rules that keep it predictable
 *
 * - **The first occurrence wins** for every single-valued field. A second date, priority
 *   or project is ordinary text, so "meet monday about tuesday" is due Monday and still
 *   says "about tuesday". Tags accumulate, de-duplicated, up to `MAX_TAGS_PER_TASK`.
 * - **A weekday resolves forward.** A bare weekday is the first one strictly after
 *   `today`; `next <weekday>` is that weekday in the week after this one (weeks start
 *   Monday), so on a Saturday `sunday` is tomorrow and `next sunday` is eight days out.
 *   `next week` is next Monday. `jan 5` is the first 5 January on or after `today`.
 * - **A time with no date is today**, so `5pm` alone is a complete plan.
 * - **An unknown `#project` or `@tag` stays in the title**, and is reported in
 *   `unknownProjects` / `unknownTags` so a client can offer to create it. A caller that
 *   passes no `projects`/`tags` resolves nothing, which is the safe default.
 * - **Nothing is parsed away entirely.** If removing every match would leave an empty
 *   title, the whole line is the title and no field is set: typing "tomorrow" creates a
 *   task called "tomorrow".
 * - **A line that parses nothing is untouched**, whitespace included, so capture can
 *   never quietly rewrite what was typed.
 * - **Capture never refuses a line.** An unreadable operator value or an impossible date
 *   is text, not an error; the worst outcome is a longer title.
 *
 * Out of scope, deliberately: locale date orders (`9/5` is text, not a date), month and
 * year offsets (`in 2 months` is text), and anything needing a model rather than a table.
 */

export type CaptureSpanKind =
  | "dueDate"
  | "dueTime"
  | "deferUntil"
  | "deadline"
  | "priority"
  | "project"
  | "tag"
  | "recurrence";

/** One matched run of the input: where it was, what it meant, and how to label it. */
export interface CaptureSpan {
  /** The field the run set; a run that sets a date and a time is labelled by the date. */
  readonly kind: CaptureSpanKind;
  /** Half-open `[start, end)` character range in the original text. */
  readonly start: number;
  readonly end: number;
  /** The text exactly as typed. */
  readonly text: string;
  /** The resolved value: a date, a time, a priority, a project or tag name. */
  readonly value: string;
  /** A short chip label, e.g. "Planned 2026-09-06 at 17:00". */
  readonly label: string;
  /**
   * False for a `#project` or `@tag` the workspace does not have. Such a span is
   * reported so the chip row can offer to create it, but its text stays in the title.
   */
  readonly known: boolean;
}

export interface CaptureOptions {
  /** The workspace's calendar date; every relative phrase is resolved against it. */
  readonly today: PlainDate;
  /** Project names that exist, matched case-insensitively. */
  readonly projects?: readonly string[] | undefined;
  /** Tag names that exist, matched case-insensitively. */
  readonly tags?: readonly string[] | undefined;
}

export interface CaptureResult {
  /** The text with every match removed; the caller still validates it as a title. */
  readonly title: string;
  readonly dueDate: PlainDate | null;
  readonly dueTime: PlainTime | null;
  readonly deferUntil: PlainDate | null;
  readonly deadline: PlainDate | null;
  readonly deadlineTime: PlainTime | null;
  readonly priority: Priority | null;
  readonly projectName: string | null;
  readonly tagNames: readonly string[];
  readonly recurrence: RecurrenceRule | null;
  /** In the order the runs appear in the text, so a chip row reads left to right. */
  readonly spans: readonly CaptureSpan[];
  /** Names typed as `#name` that no project answers to. */
  readonly unknownProjects: readonly string[];
  /** Names typed as `@name` that no tag answers to. */
  readonly unknownTags: readonly string[];
}

/** Nothing parsed: the line is the title, unchanged. */
function literal(title: string): CaptureResult {
  return {
    title,
    dueDate: null,
    dueTime: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    priority: null,
    projectName: null,
    tagNames: [],
    recurrence: null,
    spans: [],
    unknownProjects: [],
    unknownTags: [],
  };
}

interface Token {
  /** Lower-cased, with one trailing comma or semicolon dropped. */
  readonly word: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/** One token per run of non-blank characters, where a double-quoted span counts as one. */
const TOKEN = /(?:[^\s"]+|"[^"]*"?)+/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0];
    tokens.push({
      word: raw.replace(/[,;]$/, "").toLocaleLowerCase("en-US"),
      raw,
      start: match.index,
      end: match.index + raw.length,
    });
  }
  return tokens;
}

function unquote(value: string): string {
  return value
    .replace(/^"([^"]*)"?$/s, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function key(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

/* ---------------------------------------------------------- date and time */

const PRIORITY_LABELS: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const PRIORITY_DIGITS: Record<string, Priority> = {
  p1: "urgent",
  p2: "high",
  p3: "medium",
  p4: "low",
};

const WEEKDAY_WORDS: Record<string, Weekday> = {
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

const MONTH_WORDS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_OF_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?$/;
const YEAR = /^\d{4}$/;
const MAX_DAY_OFFSET = 999;

/** The first date strictly after `today` that falls on `weekday`. */
function nextWeekday(today: PlainDate, weekday: Weekday): PlainDate {
  const from = WEEKDAYS.indexOf(weekdayOf(today));
  const to = WEEKDAYS.indexOf(weekday);
  return addDays(today, ((to - from + 6) % 7) + 1);
}

/** Monday of the week after the one containing `today`; weeks start on Monday. */
function nextMonday(today: PlainDate): PlainDate {
  return addDays(today, 7 - WEEKDAYS.indexOf(weekdayOf(today)));
}

/** `next <weekday>`: that weekday in the week after this one. */
function weekdayNextWeek(today: PlainDate, weekday: Weekday): PlainDate {
  return addDays(nextMonday(today), WEEKDAYS.indexOf(weekday));
}

function safeDate(value: string): PlainDate | null {
  try {
    return toPlainDate(value);
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A month/day pair as the first such date on or after `today`, or in an explicit year. */
function monthDay(
  today: PlainDate,
  month: number,
  day: number,
  year: number | null,
): PlainDate | null {
  if (year !== null) return safeDate(`${year}-${pad(month)}-${pad(day)}`);
  const thisYear = Number(today.slice(0, 4));
  const candidate = safeDate(`${thisYear}-${pad(month)}-${pad(day)}`);
  if (candidate === null) return null;
  return candidate >= today
    ? candidate
    : safeDate(`${thisYear + 1}-${pad(month)}-${pad(day)}`);
}

interface Match<T> {
  readonly consumed: number;
  readonly value: T;
}

/** A date phrase starting at `index`, or null when the tokens are ordinary text. */
function matchDate(
  tokens: readonly Token[],
  index: number,
  today: PlainDate,
): Match<PlainDate> | null {
  const at = (offset: number) => tokens[index + offset]?.word ?? "";
  const first = at(0);

  if (first === "today") return { consumed: 1, value: today };
  if (first === "tomorrow" || first === "tmr") {
    return { consumed: 1, value: addDays(today, 1) };
  }

  if (first === "next") {
    if (at(1) === "week") return { consumed: 2, value: nextMonday(today) };
    const weekday = WEEKDAY_WORDS[at(1)];
    return weekday ? { consumed: 2, value: weekdayNextWeek(today, weekday) } : null;
  }

  const bareWeekday = WEEKDAY_WORDS[first];
  if (bareWeekday) return { consumed: 1, value: nextWeekday(today, bareWeekday) };

  if (first === "in") {
    const count = Number(at(1));
    const unit = at(2);
    if (!Number.isInteger(count) || count < 1 || count > MAX_DAY_OFFSET) return null;
    if (unit === "day" || unit === "days") {
      return { consumed: 3, value: addDays(today, count) };
    }
    if (unit === "week" || unit === "weeks") {
      return { consumed: 3, value: addDays(today, count * 7) };
    }
    return null;
  }

  if (ISO_DATE.test(first)) {
    const iso = safeDate(first);
    return iso === null ? null : { consumed: 1, value: iso };
  }

  // `jan 5`, `january 5th`, `jan 5 2029`
  const leadingMonth = MONTH_WORDS[first];
  if (leadingMonth !== undefined) {
    const day = DAY_OF_MONTH.exec(at(1));
    if (!day) return null;
    const year = YEAR.test(at(2)) ? Number(at(2)) : null;
    const date = monthDay(today, leadingMonth, Number(day[1]), year);
    return date === null ? null : { consumed: year === null ? 2 : 3, value: date };
  }

  // `20 sep`, `5th january 2029`
  const day = DAY_OF_MONTH.exec(first);
  const trailingMonth = MONTH_WORDS[at(1)];
  if (day && trailingMonth !== undefined) {
    const year = YEAR.test(at(2)) ? Number(at(2)) : null;
    const date = monthDay(today, trailingMonth, Number(day[1]), year);
    return date === null ? null : { consumed: year === null ? 2 : 3, value: date };
  }

  return null;
}

const CLOCK_12 = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/;
const CLOCK_24 = /^(\d{1,2}):(\d{2})$/;

function safeTime(hour: number, minute: number): PlainTime | null {
  try {
    return toPlainTime(`${pad(hour)}:${pad(minute)}`);
  } catch {
    return null;
  }
}

/** A time phrase starting at `index`, or null. An `at` may lead it. */
function matchTime(tokens: readonly Token[], index: number): Match<PlainTime> | null {
  const lead = tokens[index]?.word === "at" ? 1 : 0;
  const word = tokens[index + lead]?.word ?? "";

  if (word === "noon") return { consumed: lead + 1, value: "12:00" as PlainTime };
  if (word === "midnight") return { consumed: lead + 1, value: "00:00" as PlainTime };

  const twelve = CLOCK_12.exec(word);
  if (twelve) {
    const hour = Number(twelve[1]);
    if (hour < 1 || hour > 12) return null;
    const hour24 =
      twelve[3] === "pm" ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
    const time = safeTime(hour24, Number(twelve[2] ?? "0"));
    return time === null ? null : { consumed: lead + 1, value: time };
  }

  const twentyFour = CLOCK_24.exec(word);
  if (twentyFour) {
    const time = safeTime(Number(twentyFour[1]), Number(twentyFour[2]));
    return time === null ? null : { consumed: lead + 1, value: time };
  }

  return null;
}

/* ---------------------------------------------------------------- matching */

type Found =
  | { readonly kind: "dueDate"; readonly date: PlainDate }
  | { readonly kind: "dueTime"; readonly time: PlainTime }
  | { readonly kind: "deferUntil"; readonly date: PlainDate }
  | { readonly kind: "deadline"; readonly date: PlainDate }
  | { readonly kind: "deadlineTime"; readonly time: PlainTime }
  | { readonly kind: "priority"; readonly priority: Priority }
  | { readonly kind: "project"; readonly name: string }
  | { readonly kind: "tag"; readonly name: string }
  | { readonly kind: "recurrence"; readonly phrase: string };

/** What the tokens starting at one position mean, and how many of them are used. */
interface Step {
  readonly consumed: number;
  readonly found: readonly Found[];
}

const DEFER_LEADS = new Set(["defer", "start", "starts", "starting", "postpone"]);
const DEFER_FILLERS = new Set(["until", "till", "to", "on", "from"]);
const MAX_RECURRENCE_TOKENS = 6;

/** The longest `every …` phrase that `parseRecurrencePhrase` accepts, if any. */
function matchRecurrence(
  tokens: readonly Token[],
  index: number,
  today: PlainDate,
): Match<string> | null {
  if (tokens[index]?.word !== "every") return null;
  const most = Math.min(MAX_RECURRENCE_TOKENS, tokens.length - index - 1);
  for (let length = most; length >= 1; length -= 1) {
    const phrase = tokens
      .slice(index + 1, index + 1 + length)
      .map((token) => token.word)
      .join(" ");
    // The anchor only fills in defaults, so it cannot change how much text parses.
    const rule = parseRecurrencePhrase(phrase, {
      defaultWeekday: weekdayOf(today),
      defaultMonthDay: Number(today.slice(8, 10)),
    });
    if (rule) return { consumed: length + 1, value: phrase };
  }
  return null;
}

/** The `priority:` and `tag:` operators of the search grammar (spec 9.8, GAP-02). */
function matchOperator(raw: string): Found | null {
  if (!/^(priority|tag):/i.test(raw)) return null;
  try {
    const { filters } = parseSearchQuery(raw);
    if (filters.priority) return { kind: "priority", priority: filters.priority };
    if (filters.tag) return { kind: "tag", name: filters.tag };
  } catch {
    // An unknown value is ordinary text here; capture never refuses a line.
  }
  return null;
}

/** A date, optionally followed by a time, as a due or deadline pair. */
function dateAndTime(
  tokens: readonly Token[],
  index: number,
  today: PlainDate,
  lead: number,
  as: "due" | "deadline",
): Step | null {
  const date = matchDate(tokens, index + lead, today);
  if (!date) return null;
  const time = matchTime(tokens, index + lead + date.consumed);
  const dateFound: Found =
    as === "due"
      ? { kind: "dueDate", date: date.value }
      : { kind: "deadline", date: date.value };
  const timeFound: Found | null =
    time === null
      ? null
      : as === "due"
        ? { kind: "dueTime", time: time.value }
        : { kind: "deadlineTime", time: time.value };
  return {
    consumed: lead + date.consumed + (time?.consumed ?? 0),
    found: timeFound ? [dateFound, timeFound] : [dateFound],
  };
}

/** What the tokens starting at `index` mean, or null when they are ordinary text. */
function matchAt(
  tokens: readonly Token[],
  index: number,
  today: PlainDate,
): Step | null {
  const token = tokens[index] as Token;
  const { word, raw } = token;

  const repeat = matchRecurrence(tokens, index, today);
  if (repeat) {
    return {
      consumed: repeat.consumed,
      found: [{ kind: "recurrence", phrase: repeat.value }],
    };
  }

  if (word === "due") {
    // "due by <date>" is the hard limit; "due <date>" is the planned day.
    if (tokens[index + 1]?.word === "by")
      return dateAndTime(tokens, index, today, 2, "deadline");
    const planned = dateAndTime(tokens, index, today, 1, "due");
    if (planned) return planned;
    const time = matchTime(tokens, index + 1);
    return time
      ? { consumed: 1 + time.consumed, found: [{ kind: "dueTime", time: time.value }] }
      : null;
  }

  if (DEFER_LEADS.has(word)) {
    const filler = DEFER_FILLERS.has(tokens[index + 1]?.word ?? "") ? 1 : 0;
    const date = matchDate(tokens, index + 1 + filler, today);
    return date
      ? {
          consumed: 1 + filler + date.consumed,
          found: [{ kind: "deferUntil", date: date.value }],
        }
      : null;
  }

  if (word === "deadline") {
    const next = tokens[index + 1]?.word ?? "";
    const filler = next === "on" || next === "by" ? 1 : 0;
    return dateAndTime(tokens, index, today, 1 + filler, "deadline");
  }

  const plain = dateAndTime(tokens, index, today, 0, "due");
  if (plain) return plain;

  const time = matchTime(tokens, index);
  if (time) {
    return { consumed: time.consumed, found: [{ kind: "dueTime", time: time.value }] };
  }

  const digit = PRIORITY_DIGITS[word];
  if (digit) return { consumed: 1, found: [{ kind: "priority", priority: digit }] };
  if (word === "!!") {
    return { consumed: 1, found: [{ kind: "priority", priority: "high" }] };
  }
  if (word === "!!!") {
    return { consumed: 1, found: [{ kind: "priority", priority: "urgent" }] };
  }

  const operator = matchOperator(raw);
  if (operator) return { consumed: 1, found: [operator] };

  if (raw.startsWith("#") && raw.length > 1) {
    const name = unquote(raw.slice(1));
    return name ? { consumed: 1, found: [{ kind: "project", name }] } : null;
  }
  if (raw.startsWith("@") && raw.length > 1) {
    const name = unquote(raw.slice(1));
    return name ? { consumed: 1, found: [{ kind: "tag", name }] } : null;
  }

  return null;
}

/* -------------------------------------------------------------------- parse */

function labelOf(found: Found, value: string): string {
  switch (found.kind) {
    case "dueDate":
      return `Planned ${value}`;
    case "dueTime":
    case "deadlineTime":
      return `at ${value}`;
    case "deferUntil":
      return `Deferred until ${value}`;
    case "deadline":
      return `Deadline ${value}`;
    case "priority":
      return PRIORITY_LABELS[found.priority];
    case "project":
      return `Project ${value}`;
    case "tag":
      return `Tag ${value}`;
    case "recurrence":
      return `Repeats every ${value}`;
  }
}

function valueOf(found: Found): string {
  switch (found.kind) {
    case "dueDate":
    case "deferUntil":
    case "deadline":
      return found.date;
    case "dueTime":
    case "deadlineTime":
      return found.time;
    case "priority":
      return found.priority;
    case "project":
    case "tag":
      return found.name;
    case "recurrence":
      return found.phrase;
  }
}

/** A chip kind is the field the run is named after; a time rides with its date. */
function spanKindOf(found: Found): CaptureSpanKind {
  return found.kind === "deadlineTime" ? "deadline" : found.kind;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

/** The text with `removals` cut out and the resulting whitespace collapsed. */
function withoutRanges(text: string, removals: readonly Range[]): string {
  let kept = "";
  let cursor = 0;
  for (const range of [...removals].sort((left, right) => left.start - right.start)) {
    if (range.start >= cursor) kept += text.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  kept += text.slice(cursor);
  return kept.replace(/\s+/g, " ").trim();
}

function lookup(names: readonly string[] | undefined): Map<string, string> {
  return new Map((names ?? []).map((name) => [key(name), name]));
}

/** Everything the scan has settled so far; only `apply` writes to it. */
interface State {
  dueDate: PlainDate | null;
  dueTime: PlainTime | null;
  deferUntil: PlainDate | null;
  deadline: PlainDate | null;
  deadlineTime: PlainTime | null;
  priority: Priority | null;
  projectName: string | null;
  recurrencePhrase: string | null;
  readonly tagNames: string[];
}

/**
 * What a match may do, decided before anything is written: `rejected` is a field that is
 * already set, `duplicate` a tag already carried (its text still goes), and `unknown` a
 * project or tag the workspace does not have.
 */
type Outcome = "applied" | "duplicate" | "rejected" | "unknown";

interface Verdict {
  readonly outcome: Outcome;
  /** The match, with a project or tag name resolved to the workspace's own spelling. */
  readonly found: Found;
}

function judge(
  found: Found,
  state: State,
  projects: Map<string, string>,
  tags: Map<string, string>,
): Verdict {
  const taken = (value: unknown): Verdict => ({
    outcome: value === null ? "applied" : "rejected",
    found,
  });

  switch (found.kind) {
    case "dueDate":
      return taken(state.dueDate);
    case "dueTime":
      return taken(state.dueTime);
    case "deferUntil":
      return taken(state.deferUntil);
    case "deadline":
      return taken(state.deadline);
    case "deadlineTime":
      return taken(state.deadlineTime);
    case "priority":
      return taken(state.priority);
    case "recurrence":
      return taken(state.recurrencePhrase);
    case "project": {
      if (state.projectName !== null) return { outcome: "rejected", found };
      const known = projects.get(key(found.name));
      return known === undefined
        ? { outcome: "unknown", found }
        : { outcome: "applied", found: { kind: "project", name: known } };
    }
    case "tag": {
      const known = tags.get(key(found.name));
      if (known === undefined) return { outcome: "unknown", found };
      const resolved: Found = { kind: "tag", name: known };
      if (
        state.tagNames.includes(known) ||
        state.tagNames.length >= MAX_TAGS_PER_TASK
      ) {
        return { outcome: "duplicate", found: resolved };
      }
      return { outcome: "applied", found: resolved };
    }
  }
}

function apply(found: Found, state: State): void {
  switch (found.kind) {
    case "dueDate":
      state.dueDate = found.date;
      break;
    case "dueTime":
      state.dueTime = found.time;
      break;
    case "deferUntil":
      state.deferUntil = found.date;
      break;
    case "deadline":
      state.deadline = found.date;
      break;
    case "deadlineTime":
      state.deadlineTime = found.time;
      break;
    case "priority":
      state.priority = found.priority;
      break;
    case "recurrence":
      state.recurrencePhrase = found.phrase;
      break;
    case "project":
      state.projectName = found.name;
      break;
    case "tag":
      state.tagNames.push(found.name);
      break;
  }
}

export function parseCapture(text: string, options: CaptureOptions): CaptureResult {
  const source = text.normalize("NFC");
  const tokens = tokenize(source);
  const projects = lookup(options.projects);
  const tags = lookup(options.tags);

  const state: State = {
    dueDate: null,
    dueTime: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    priority: null,
    projectName: null,
    recurrencePhrase: null,
    tagNames: [],
  };
  const spans: CaptureSpan[] = [];
  const removals: Range[] = [];
  const unknownProjects: string[] = [];
  const unknownTags: string[] = [];
  let recurrenceSpan = -1;
  let escaped = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;

    // A leading backslash keeps the token as text; only the backslash itself is dropped.
    if (token.raw.startsWith("\\") && token.raw.length > 1) {
      removals.push({ start: token.start, end: token.start + 1 });
      escaped = true;
      continue;
    }

    const step = matchAt(tokens, index, options.today);
    if (!step) continue;

    const last = tokens[index + step.consumed - 1] as Token;
    const range = { start: token.start, end: last.end };
    const body = source.slice(range.start, range.end);

    // Decided before anything is written: a run either lands whole or stays as text, so
    // a phrase whose date was already taken never leaves half of itself behind.
    const verdicts = step.found.map((found) => judge(found, state, projects, tags));

    const unknown = verdicts.find((verdict) => verdict.outcome === "unknown");
    if (unknown) {
      const kind = unknown.found.kind === "project" ? "project" : "tag";
      const value = valueOf(unknown.found);
      const seen = kind === "project" ? unknownProjects : unknownTags;
      if (!seen.includes(value)) seen.push(value);
      // The text stays put, but the chip row still says why nothing was applied.
      spans.push({
        kind,
        ...range,
        text: body,
        value,
        label: `No ${kind} "${value}"`,
        known: false,
      });
      continue;
    }
    if (verdicts.some((verdict) => verdict.outcome === "rejected")) continue;

    const applied = verdicts
      .filter((verdict) => verdict.outcome === "applied")
      .map((verdict) => verdict.found);
    for (const found of applied) apply(found, state);

    const head = applied[0];
    if (head) {
      if (head.kind === "recurrence") recurrenceSpan = spans.length;
      spans.push({
        kind: spanKindOf(head),
        ...range,
        text: body,
        value: valueOf(head),
        label: applied.map((found) => labelOf(found, valueOf(found))).join(" "),
        known: true,
      });
    }
    removals.push(range);
    index += step.consumed - 1;
  }

  if (spans.length === 0) {
    return literal(escaped ? withoutRanges(source, removals) : source.trim());
  }

  const title = withoutRanges(source, removals);
  // Nothing may be parsed away entirely: a bare "tomorrow" is a task called "tomorrow".
  if (title.length === 0) return literal(source.trim());

  const anchor = state.dueDate ?? options.today;
  const recurrence =
    state.recurrencePhrase === null
      ? null
      : parseRecurrencePhrase(state.recurrencePhrase, {
          defaultWeekday: weekdayOf(anchor),
          defaultMonthDay: Number(anchor.slice(8, 10)),
        });
  if (recurrence !== null && recurrenceSpan >= 0) {
    const span = spans[recurrenceSpan] as CaptureSpan;
    spans[recurrenceSpan] = { ...span, label: describeRecurrence(recurrence) };
  }

  return {
    title,
    // A time on its own means today, so the request is complete either way.
    dueDate: state.dueDate ?? (state.dueTime !== null ? options.today : null),
    dueTime: state.dueTime,
    deferUntil: state.deferUntil,
    deadline: state.deadline,
    deadlineTime: state.deadlineTime,
    priority: state.priority,
    projectName: state.projectName,
    tagNames: state.tagNames,
    recurrence,
    spans,
    unknownProjects,
    unknownTags,
  };
}

/**
 * The text with one span taken out, for a chip's remove control: the span and the space
 * that separated it from its neighbour go together, so nothing is left doubled.
 */
export function removeSpan(text: string, span: CaptureSpan): string {
  const before = text.slice(0, span.start).replace(/\s+$/, "");
  const after = text.slice(span.end).replace(/^\s+/, "");
  if (before.length === 0) return after;
  if (after.length === 0) return before;
  return `${before} ${after}`;
}

/* ---------------------------------------------------------------- fixtures */

/** The calendar date every example is resolved against: Saturday 5 September 2026. */
export const CAPTURE_EXAMPLE_TODAY = "2026-09-05" as PlainDate;
export const CAPTURE_EXAMPLE_PROJECTS = ["Launch", "Q3 launch", "Home"] as const;
export const CAPTURE_EXAMPLE_TAGS = ["phone", "deep work", "errands"] as const;

/** What an example expects; every field left out must come back null or empty. */
export interface CaptureExample {
  readonly text: string;
  readonly title: string;
  readonly dueDate?: string;
  readonly dueTime?: string;
  readonly deferUntil?: string;
  readonly deadline?: string;
  readonly deadlineTime?: string;
  readonly priority?: Priority;
  readonly projectName?: string;
  readonly tagNames?: readonly string[];
  /** `describeRecurrence` of the expected rule, which reads better than the JSON. */
  readonly recurrence?: string;
  readonly unknownProjects?: readonly string[];
  readonly unknownTags?: readonly string[];
  /** Why the row is here, for the rows whose answer is not obvious. */
  readonly note?: string;
}

/**
 * The grammar by example (spec 10.1 as amended). The domain test asserts every row, and
 * the web and CLI tests replay the same rows through their own request builders, which
 * is what proves a phrase means the same thing in both products.
 */
export const CAPTURE_EXAMPLES: readonly CaptureExample[] = [
  // --- the headline case -------------------------------------------------
  {
    text: "Call Sam tomorrow 5pm p1 #Launch @phone",
    title: "Call Sam",
    dueDate: "2026-09-06",
    dueTime: "17:00",
    priority: "urgent",
    projectName: "Launch",
    tagNames: ["phone"],
  },

  // --- plain text --------------------------------------------------------
  { text: "Buy milk", title: "Buy milk" },
  {
    text: "Read  the   Bhagavad Gita",
    title: "Read  the   Bhagavad Gita",
    note: "nothing parsed, so even the spacing is untouched",
  },
  {
    text: "Email the p1 vendor list",
    title: "Email the vendor list",
    priority: "urgent",
    note: "a token counts wherever it stands, not only at the end",
  },

  // --- relative dates ----------------------------------------------------
  { text: "Standup today", title: "Standup", dueDate: "2026-09-05" },
  { text: "Standup tomorrow", title: "Standup", dueDate: "2026-09-06" },
  { text: "Standup tmr", title: "Standup", dueDate: "2026-09-06" },
  {
    text: "Ship the deck next week",
    title: "Ship the deck",
    dueDate: "2026-09-07",
    note: "next week is next Monday",
  },
  { text: "Gym monday", title: "Gym", dueDate: "2026-09-07" },
  { text: "Gym mon", title: "Gym", dueDate: "2026-09-07" },
  {
    text: "Gym sunday",
    title: "Gym",
    dueDate: "2026-09-06",
    note: "a bare weekday is the next one, which here is tomorrow",
  },
  {
    text: "Gym next sunday",
    title: "Gym",
    dueDate: "2026-09-13",
    note: "next <weekday> is in the week after this one",
  },
  { text: "Gym next saturday", title: "Gym", dueDate: "2026-09-12" },
  {
    text: "Gym saturday",
    title: "Gym",
    dueDate: "2026-09-12",
    note: "today is a Saturday, and a weekday always resolves forward",
  },
  { text: "Review in 3 days", title: "Review", dueDate: "2026-09-08" },
  { text: "Review in 2 weeks", title: "Review", dueDate: "2026-09-19" },
  {
    text: "Review in 2 months",
    title: "Review in 2 months",
    note: "month and year offsets are out of scope",
  },
  {
    text: "Pack, tomorrow, for the trip",
    title: "Pack, for the trip",
    dueDate: "2026-09-06",
    note: "one trailing comma does not hide a token",
  },

  // --- absolute dates ----------------------------------------------------
  { text: "Renew passport 2026-11-30", title: "Renew passport", dueDate: "2026-11-30" },
  {
    text: "Renew passport 2026-02-30",
    title: "Renew passport 2026-02-30",
    note: "not a real calendar date, so it stays text",
  },
  {
    text: "Taxes jan 5",
    title: "Taxes",
    dueDate: "2027-01-05",
    note: "a month and day already past this year roll into the next",
  },
  { text: "Taxes jan 5 2029", title: "Taxes", dueDate: "2029-01-05" },
  { text: "Conference sep 20", title: "Conference", dueDate: "2026-09-20" },
  { text: "Conference 20 sep", title: "Conference", dueDate: "2026-09-20" },
  { text: "Conference september 20th", title: "Conference", dueDate: "2026-09-20" },
  {
    text: "Invoice 9/5",
    title: "Invoice 9/5",
    note: "slash dates are locale-ambiguous and stay text",
  },
  {
    text: "Party feb 30",
    title: "Party feb 30",
    note: "an impossible day is text, not a clamp",
  },

  // --- times -------------------------------------------------------------
  {
    text: "Call the bank 5pm",
    title: "Call the bank",
    dueDate: "2026-09-05",
    dueTime: "17:00",
    note: "a time with no date is today",
  },
  {
    text: "Call the bank at 5:30pm",
    title: "Call the bank",
    dueDate: "2026-09-05",
    dueTime: "17:30",
  },
  {
    text: "Call the bank 17:00",
    title: "Call the bank",
    dueDate: "2026-09-05",
    dueTime: "17:00",
  },
  { text: "Lunch noon", title: "Lunch", dueDate: "2026-09-05", dueTime: "12:00" },
  { text: "Backup midnight", title: "Backup", dueDate: "2026-09-05", dueTime: "00:00" },
  { text: "Call 12am", title: "Call", dueDate: "2026-09-05", dueTime: "00:00" },
  { text: "Call 12pm", title: "Call", dueDate: "2026-09-05", dueTime: "12:00" },
  {
    text: "Retro tomorrow at 9am",
    title: "Retro",
    dueDate: "2026-09-06",
    dueTime: "09:00",
  },
  {
    text: "Retro monday 9:15",
    title: "Retro",
    dueDate: "2026-09-07",
    dueTime: "09:15",
  },
  {
    text: "Order 25 pizzas",
    title: "Order 25 pizzas",
    note: "a bare number is never a time",
  },
  {
    text: "Read pages 25:99",
    title: "Read pages 25:99",
    note: "25:99 is not a clock time",
  },

  // --- explicit due, defer, deadline (ADR-013) ---------------------------
  { text: "Pay rent due tomorrow", title: "Pay rent", dueDate: "2026-09-06" },
  {
    text: "File report due 2026-10-01 at 9am",
    title: "File report",
    dueDate: "2026-10-01",
    dueTime: "09:00",
  },
  {
    text: "Renew lease defer until monday",
    title: "Renew lease",
    deferUntil: "2026-09-07",
  },
  {
    text: "Draft brief start tomorrow",
    title: "Draft brief",
    deferUntil: "2026-09-06",
  },
  {
    text: "Draft brief starting in 3 days",
    title: "Draft brief",
    deferUntil: "2026-09-08",
  },
  {
    text: "Submit grant deadline 2026-09-30",
    title: "Submit grant",
    deadline: "2026-09-30",
  },
  {
    text: "Submit grant deadline 2026-09-30 17:00",
    title: "Submit grant",
    deadline: "2026-09-30",
    deadlineTime: "17:00",
  },
  {
    text: "Ship it due by friday",
    title: "Ship it",
    deadline: "2026-09-11",
    note: "due by is the hard limit, not the planned day",
  },
  {
    text: "Plan trip start monday due friday deadline 2026-09-30",
    title: "Plan trip",
    dueDate: "2026-09-11",
    deferUntil: "2026-09-07",
    deadline: "2026-09-30",
    note: "all three dates in one line",
  },
  {
    text: "Deadline discipline matters",
    title: "Deadline discipline matters",
    note: "a lead word with no date after it is ordinary text",
  },
  {
    text: "Start the engine",
    title: "Start the engine",
    note: "and the same for start",
  },

  // --- priority ----------------------------------------------------------
  { text: "Fix the leak p1", title: "Fix the leak", priority: "urgent" },
  { text: "Fix the leak p2", title: "Fix the leak", priority: "high" },
  { text: "Fix the leak p3", title: "Fix the leak", priority: "medium" },
  { text: "Fix the leak p4", title: "Fix the leak", priority: "low" },
  { text: "Fix the leak !!", title: "Fix the leak", priority: "high" },
  { text: "Fix the leak !!!", title: "Fix the leak", priority: "urgent" },
  {
    text: "Fix the leak !",
    title: "Fix the leak !",
    note: "one bang is punctuation far more often than a priority",
  },
  {
    text: "Fix the leak priority:high",
    title: "Fix the leak",
    priority: "high",
    note: "the search grammar's own operator (spec 9.8)",
  },
  {
    text: "Fix the leak priority:screaming",
    title: "Fix the leak priority:screaming",
    note: "an unknown value is text; capture never refuses a line",
  },
  { text: "Fix the leak p5", title: "Fix the leak p5", note: "the ladder is p1 to p4" },
  {
    text: "Fix the leak p1 p4",
    title: "Fix the leak p4",
    priority: "urgent",
    note: "the first of a single-valued field wins",
  },

  // --- projects and tags -------------------------------------------------
  { text: "Write copy #Launch", title: "Write copy", projectName: "Launch" },
  {
    text: "Write copy #launch",
    title: "Write copy",
    projectName: "Launch",
    note: "names match case-insensitively and keep the project's own casing",
  },
  { text: 'Write copy #"Q3 launch"', title: "Write copy", projectName: "Q3 launch" },
  {
    text: "Write copy #marketing",
    title: "Write copy #marketing",
    unknownProjects: ["marketing"],
    note: "an unknown project stays in the title and is offered for creation",
  },
  {
    text: "Write copy #Home #Launch",
    title: "Write copy #Launch",
    projectName: "Home",
    note: "a task has one project, so the first wins",
  },
  { text: "Call mum @phone", title: "Call mum", tagNames: ["phone"] },
  {
    text: 'Deep dive @"deep work" @errands',
    title: "Deep dive",
    tagNames: ["deep work", "errands"],
  },
  {
    text: "Call mum @phone @phone",
    title: "Call mum",
    tagNames: ["phone"],
    note: "a repeated tag is applied once",
  },
  { text: "Call mum @mobile", title: "Call mum @mobile", unknownTags: ["mobile"] },
  {
    text: 'Read tag:"deep work"',
    title: "Read",
    tagNames: ["deep work"],
    note: "the search grammar's tag operator",
  },
  {
    text: "Email sam@example.com",
    title: "Email sam@example.com",
    note: "a marker only counts at the start of a token",
  },
  {
    text: "Fix #12 in the parser",
    title: "Fix #12 in the parser",
    unknownProjects: ["12"],
    note: "an issue number reads as a project, but stays put because none exists",
  },

  // --- the escape --------------------------------------------------------
  {
    text: "Fix \\#Launch in the parser",
    title: "Fix #Launch in the parser",
    note: "a backslash keeps the next token literal",
  },
  { text: "Ship \\tomorrow the release", title: "Ship tomorrow the release" },
  { text: "Mail \\@phone about it", title: "Mail @phone about it" },

  // --- recurrence (GAP-12, ADR-012) --------------------------------------
  { text: "Water plants every day", title: "Water plants", recurrence: "Every day" },
  {
    text: "Standup every weekdays",
    title: "Standup",
    recurrence: "Every week on weekdays",
  },
  {
    text: "Pay rent every month on 1",
    title: "Pay rent",
    recurrence: "Every month on the 1st",
  },
  {
    text: "Retro every 2 weeks on mon,thu",
    title: "Retro",
    recurrence: "Every 2 weeks on Mon, Thu",
  },
  {
    text: "Review every week",
    title: "Review",
    recurrence: "Every week on Sat",
    note: "a bare weekly rule falls on the anchor's weekday, which here is today",
  },
  {
    text: "Review every week monday",
    title: "Review",
    dueDate: "2026-09-07",
    recurrence: "Every week on Mon",
    note: "the due date is the anchor, so the rule follows it",
  },
  {
    text: "Take out bins every friday",
    title: "Take out bins",
    recurrence: "Every week on Fri",
  },
  {
    text: "Backup every month on last fri",
    title: "Backup",
    recurrence: "Every month on the last Friday",
  },
  {
    text: "Invoice every month until 2026-12-31",
    title: "Invoice",
    recurrence: "Every month on the 5th, until 2026-12-31",
  },
  {
    text: "Physio every week for 10 times",
    title: "Physio",
    recurrence: "Every week on Sat, 10 occurrences left",
  },
  {
    text: "Every good boy deserves fruit",
    title: "Every good boy deserves fruit",
    note: "a phrase the recurrence grammar cannot read stays text",
  },

  // --- the whole-line guard ----------------------------------------------
  { text: "tomorrow", title: "tomorrow", note: "nothing may be parsed away entirely" },
  { text: "#Launch", title: "#Launch" },
  { text: "every day", title: "every day" },
  {
    text: "p1 tomorrow 5pm",
    title: "p1 tomorrow 5pm",
    note: "the same guard when several matches together would empty the title",
  },
];
