import {
  DomainError,
  localDateFormatter,
  toLocalTime,
  toPlainDate,
  toPlainTime,
  toReminderOffset,
  type PlainDate,
  type PlainTime,
} from "@morrowlist/domain";
import ICAL from "ical.js";

/**
 * A CalDAV precondition failure (RFC 4791 §5.3.2.1). The HTTP layer answers 403 with the
 * named precondition element so a client such as Calendar.app shows the message and
 * reverts its change instead of silently diverging from the task.
 */
export class CalDavPreconditionError extends DomainError {
  readonly precondition: string;
  constructor(precondition: string, message: string) {
    super("VALIDATION_FAILED", message, { precondition });
    this.name = "CalDavPreconditionError";
    this.precondition = precondition;
  }
}

/** The task-shaped reading of one client VEVENT. */
export interface ParsedEvent {
  readonly uid: string;
  readonly title: string;
  readonly descriptionMd: string | null;
  readonly dueDate: PlainDate;
  readonly dueTime: PlainTime | null;
  readonly dueTimezone: string | null;
  /** Minutes before the start; null when the event has no relative display alarm. */
  readonly reminderOffsetMinutes: number | null;
  /** Properties MorrowList does not model, in jCal form, kept for the round trip. */
  readonly properties: readonly unknown[];
}

/** Properties the task owns; a client's copy is replaced by the canonical rendering. */
const CANONICAL = new Set([
  "uid",
  "summary",
  "description",
  "dtstart",
  "dtend",
  "duration",
  "dtstamp",
  "last-modified",
  "sequence",
  "url",
]);
/** Features with no task equivalent; accepting them would lose the client's intent. */
const UNSUPPORTED: Record<string, string> = {
  rrule: "Repeating events cannot be synced; set the repeat on the task in MorrowList.",
  rdate: "Repeating events cannot be synced; set the repeat on the task in MorrowList.",
  exdate:
    "Repeating events cannot be synced; set the repeat on the task in MorrowList.",
  "recurrence-id": "Occurrences of repeating events cannot be synced.",
  attendee: "Invitations cannot be synced; a task has no attendees.",
  organizer: "Invitations cannot be synced; a task has no organizer.",
};

const isValidTimezone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/**
 * Read one VEVENT from a client body. `workspaceTimezone` anchors UTC and floating times
 * so the task's wall-clock fields mean what the calendar showed.
 */
export function parseEvent(body: string, workspaceTimezone: string): ParsedEvent {
  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(body));
  } catch (error) {
    throw new CalDavPreconditionError(
      "valid-calendar-data",
      `The calendar data could not be parsed: ${(error as Error).message}`,
    );
  }
  if (calendar.name !== "vcalendar")
    throw new CalDavPreconditionError(
      "valid-calendar-object-resource",
      "The body must be a VCALENDAR.",
    );
  const events = calendar.getAllSubcomponents("vevent");
  if (events.length !== 1)
    throw new CalDavPreconditionError(
      "valid-calendar-object-resource",
      "A resource must hold exactly one VEVENT.",
    );
  if (
    calendar
      .getAllSubcomponents()
      .some((component) => !["vevent", "vtimezone"].includes(component.name))
  )
    throw new CalDavPreconditionError(
      "supported-calendar-component",
      "Only VEVENT resources are supported.",
    );
  const event = events[0]!;
  for (const [name, message] of Object.entries(UNSUPPORTED))
    if (event.hasProperty(name))
      throw new CalDavPreconditionError("supported-calendar-data", message);

  const uid = String(event.getFirstPropertyValue("uid") ?? "").trim();
  if (!uid)
    throw new CalDavPreconditionError(
      "valid-calendar-object-resource",
      "The VEVENT needs a UID.",
    );
  const title = String(event.getFirstPropertyValue("summary") ?? "").trim();
  if (!title)
    throw new CalDavPreconditionError(
      "valid-calendar-object-resource",
      "The event needs a title (SUMMARY).",
    );
  const descriptionRaw = event.getFirstPropertyValue("description");
  const descriptionMd =
    descriptionRaw === null || descriptionRaw === undefined
      ? null
      : String(descriptionRaw).trim() || null;

  const startProperty = event.getFirstProperty("dtstart");
  const start = startProperty?.getFirstValue() as ICAL.Time | null | undefined;
  if (!start || !(start instanceof ICAL.Time))
    throw new CalDavPreconditionError(
      "valid-calendar-object-resource",
      "The event needs a start (DTSTART).",
    );
  const tzidParam = startProperty!.getParameter("tzid");
  const timing = readStart(
    start,
    typeof tzidParam === "string" ? tzidParam : undefined,
    workspaceTimezone,
  );

  // A client DURATION or DTEND is kept as a duration so the block survives a move.
  const properties: unknown[] = [];
  const durationSeconds = readDurationSeconds(event, start);
  if (timing.dueTime && durationSeconds !== null && durationSeconds > 0)
    properties.push([
      "duration",
      {},
      "duration",
      ICAL.Duration.fromSeconds(durationSeconds).toString(),
    ]);
  for (const property of event.getAllProperties()) {
    if (CANONICAL.has(property.name)) continue;
    properties.push(property.toJSON());
  }

  return {
    uid,
    title,
    descriptionMd,
    dueDate: timing.dueDate,
    dueTime: timing.dueTime,
    dueTimezone: timing.dueTimezone,
    reminderOffsetMinutes: timing.dueTime ? readAlarmOffset(event) : null,
    properties,
  };
}

function readStart(
  start: ICAL.Time,
  tzid: string | undefined,
  workspaceTimezone: string,
): Pick<ParsedEvent, "dueDate" | "dueTime" | "dueTimezone"> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const wallDate = (t: ICAL.Time) =>
    toPlainDate(`${t.year}-${pad(t.month)}-${pad(t.day)}`, "dtstart");
  const wallTime = (t: ICAL.Time) =>
    toPlainTime(`${pad(t.hour)}:${pad(t.minute)}`, "dtstart");
  if (start.isDate)
    return { dueDate: wallDate(start), dueTime: null, dueTimezone: null };
  if (tzid && isValidTimezone(tzid))
    return { dueDate: wallDate(start), dueTime: wallTime(start), dueTimezone: tzid };
  if (start.zone === ICAL.Timezone.utcTimezone || tzid) {
    // UTC, or a TZID the host cannot resolve: ical.js gives the instant, which is then
    // shown in the workspace's own zone (for an unknown TZID the instant is best effort).
    const instant = start.toJSDate();
    return {
      dueDate: localDateFormatter(workspaceTimezone)(instant),
      dueTime: toLocalTime(instant, workspaceTimezone),
      dueTimezone: workspaceTimezone,
    };
  }
  // Floating time: the wall clock wherever the workspace is.
  return {
    dueDate: wallDate(start),
    dueTime: wallTime(start),
    dueTimezone: workspaceTimezone,
  };
}

function readDurationSeconds(event: ICAL.Component, start: ICAL.Time): number | null {
  const duration = event.getFirstPropertyValue("duration");
  if (duration instanceof ICAL.Duration) return duration.toSeconds();
  const end = event.getFirstPropertyValue("dtend");
  if (end instanceof ICAL.Time) return end.toUnixTime() - start.toUnixTime();
  return null;
}

/** The first display alarm relative to the start, as minutes before it. */
function readAlarmOffset(event: ICAL.Component): number | null {
  for (const alarm of event.getAllSubcomponents("valarm")) {
    const action = String(alarm.getFirstPropertyValue("action") ?? "").toUpperCase();
    if (action !== "DISPLAY" && action !== "AUDIO") continue;
    const trigger = alarm.getFirstProperty("trigger");
    const value = trigger?.getFirstValue();
    if (!(value instanceof ICAL.Duration)) continue;
    if (String(trigger?.getParameter("related") ?? "START").toUpperCase() !== "START")
      continue;
    const seconds = value.toSeconds();
    if (seconds > 0) continue;
    try {
      return toReminderOffset(Math.round(-seconds / 60));
    } catch {
      continue;
    }
  }
  return null;
}

/** Turn stored jCal properties back into unfolded ICS lines. */
export function propertyLines(properties: readonly unknown[]): string[] {
  const lines: string[] = [];
  for (const entry of properties) {
    if (!Array.isArray(entry)) continue;
    try {
      lines.push(new ICAL.Property(entry as unknown[]).toICALString());
    } catch {
      // A malformed stored property is dropped rather than breaking the resource.
    }
  }
  return lines;
}
