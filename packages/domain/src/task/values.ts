import { ValidationError } from "../shared/errors.js";

/** Task priority ladder (spec 8.1, 12.2). */
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export const TITLE_MAX_LENGTH = 500;

/**
 * Titles are required, trimmed, and 1–500 Unicode characters after trim (spec 8.1).
 * Length is counted in code points so an emoji counts once, not as its UTF-16 units.
 */
export function normalizeTitle(raw: string): string {
  // Normalising to NFC keeps composed and decomposed spellings of the same title equal.
  const trimmed = raw.normalize("NFC").trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Title is required.", { field: "title" });
  }
  const codePoints = [...trimmed].length;
  if (codePoints > TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`,
      { field: "title", length: codePoints, maxLength: TITLE_MAX_LENGTH },
    );
  }
  return trimmed;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A calendar date with no time or zone, stored as `YYYY-MM-DD` (spec 12.3). */
export type PlainDate = string & { readonly __brand: "PlainDate" };
/** A wall-clock time of day, stored as `HH:mm` (spec 12.3). */
export type PlainTime = string & { readonly __brand: "PlainTime" };

export function toPlainDate(value: string, field = "dueDate"): PlainDate {
  if (!DATE_PATTERN.test(value)) {
    throw new ValidationError("Date must be formatted as YYYY-MM-DD.", {
      field,
      value,
    });
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError("Date is not a real calendar date.", { field, value });
  }
  return value as PlainDate;
}

export function toPlainTime(value: string, field = "dueTime"): PlainTime {
  if (!TIME_PATTERN.test(value)) {
    throw new ValidationError("Time must be formatted as HH:mm.", { field, value });
  }
  return value as PlainTime;
}

/**
 * IANA timezone identifier. Validated against the host's timezone database rather than a
 * hardcoded list so the check stays correct as the database is updated.
 */
export function toTimezone(value: string, field = "timezone"): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    throw new ValidationError("Timezone must be a valid IANA identifier.", {
      field,
      value,
    });
  }
}

/** Optional Markdown description. Raw HTML is disabled at render time (spec 8.1). */
export function normalizeDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The calendar date of an instant in an IANA timezone (spec 12.3). Date-only tasks are
 * evaluated against the workspace's local date, never against UTC, so a task due "today"
 * in Auckland is still today at 23:30 there even though UTC has moved on.
 */
export function toLocalDate(instant: Date, timezone: string): PlainDate {
  return localDateFormatter(timezone)(instant);
}

/**
 * The same conversion for many instants. Building the formatter once is what makes
 * converting tens of thousands of interval boundaries affordable (flow metrics).
 */
export function localDateFormatter(timezone: string): (instant: Date) => PlainDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the PlainDate shape.
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (instant) => format.format(instant) as PlainDate;
}

/** Calendar arithmetic on a plain date; unaffected by DST because it never leaves UTC. */
export function addDays(date: PlainDate, days: number): PlainDate {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10) as PlainDate;
}
