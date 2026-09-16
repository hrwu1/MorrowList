import { addDays, taskKey, toInstant, type Task } from "@morrowlist/domain";

import type { Workspace } from "../ports/index.js";

/** RFC 5545 text escaping and UTF-8 folding: continuation whitespace counts in 75 octets. */
export function text(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      // Strip text controls before folding; CR/LF have already been escaped above.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}
export function fold(value: string): string {
  let line = "";
  const lines: string[] = [];
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}
const utc = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const dateValue = (date: string) => date.replace(/-/g, "");

/** Which of a task's calendar entries a VEVENT represents. */
export type EventResource = "task" | "deadline";

export interface TaskEvent {
  readonly resource: EventResource;
  /** Unfolded VEVENT lines from BEGIN:VEVENT to END:VEVENT inclusive. */
  readonly lines: readonly string[];
}

export interface RenderEventOptions {
  /** Replaces the generated UID of the task entry (a CalDAV client's own UID). */
  readonly uid?: string;
  /** Extra unfolded property lines for the task entry, e.g. client properties kept. */
  readonly extraLines?: readonly string[];
}

/**
 * The VEVENTs of one task: its planned entry, and a labelled deadline entry when a
 * deadline exists. Completed and trashed tasks render nothing. RRULE is deliberately
 * absent: completing creates the next task.
 */
export function renderTaskEvents(
  task: Task,
  workspace: Workspace,
  appUrl: string,
  options: RenderEventOptions = {},
): readonly TaskEvent[] {
  if (task.completedAt || task.deletedAt) return [];
  const entries = [
    ...(task.dueDate
      ? [
          {
            date: task.dueDate,
            time: task.dueTime,
            timezone: task.dueTimezone ?? workspace.timezone,
            deadline: false,
          },
        ]
      : []),
    ...(task.deadline
      ? [
          {
            date: task.deadline,
            time: task.deadlineTime,
            timezone: workspace.timezone,
            deadline: true,
          },
        ]
      : []),
  ];
  const url = new URL(
    `/tasks/${encodeURIComponent(taskKey(workspace.taskKeyPrefix, task.taskNumber))}`,
    appUrl,
  ).href;
  return entries.map((entry) => {
    const uid =
      !entry.deadline && options.uid
        ? options.uid
        : `${task.id}${entry.deadline ? "-deadline" : ""}@morrowlist`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `SEQUENCE:${task.version}`,
      `DTSTAMP:${utc(task.updatedAt)}`,
      `LAST-MODIFIED:${utc(task.updatedAt)}`,
      `SUMMARY:${text((entry.deadline ? "Deadline: " : "") + task.title)}`,
      `URL:${url}`,
    ];
    if (task.descriptionMd) lines.push(`DESCRIPTION:${text(task.descriptionMd)}`);
    if (entry.time)
      lines.push(`DTSTART:${utc(toInstant(entry.date, entry.time, entry.timezone))}`);
    else
      lines.push(
        `DTSTART;VALUE=DATE:${dateValue(entry.date)}`,
        `DTEND;VALUE=DATE:${dateValue(addDays(entry.date, 1))}`,
      );
    if (!entry.deadline) {
      // A client's DURATION only makes sense on a timed entry; all-day entries carry DTEND.
      lines.push(
        ...(options.extraLines ?? []).filter(
          (line) => entry.time || !/^DURATION[;:]/i.test(line),
        ),
      );
    }
    if (!entry.deadline && entry.time && task.reminderOffsetMinutes !== null) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${text(task.title)}`,
        `TRIGGER:-PT${task.reminderOffsetMinutes}M`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
    return { resource: entry.deadline ? "deadline" : "task", lines };
  });
}

/** Wrap unfolded VEVENT line groups in a VCALENDAR and fold for the wire. */
export function wrapCalendar(
  events: readonly (readonly string[])[],
  name: string | null,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MorrowList//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(name === null ? [] : [`X-WR-CALNAME:${text(name)}`]),
    ...events.flat(),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Open occurrences only, one calendar for a whole workspace (the ICS feed). */
export function renderCalendar(
  tasks: readonly Task[],
  workspace: Workspace,
  appUrl: string,
): string {
  return wrapCalendar(
    tasks.flatMap((task) =>
      renderTaskEvents(task, workspace, appUrl).map((event) => event.lines),
    ),
    workspace.name,
  );
}
