import { addDays, toInstant, type Task } from "@morrowlist/domain";

import type { Workspace } from "../ports/index.js";

/** RFC 5545 text escaping and UTF-8 folding: continuation whitespace counts in 75 octets. */
function text(value: string): string {
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
function fold(value: string): string {
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

/** Open occurrences only. RRULE is deliberately absent: completing creates the next task. */
export function renderCalendar(
  tasks: readonly Task[],
  workspace: Workspace,
  appUrl: string,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MorrowList//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(workspace.name)}`,
  ];
  for (const task of tasks) {
    if (task.completedAt || task.deletedAt) continue;
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
    for (const entry of entries) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${task.id}${entry.deadline ? "-deadline" : ""}@morrowlist`,
        `SEQUENCE:${task.version}`,
        `DTSTAMP:${utc(task.updatedAt)}`,
        `LAST-MODIFIED:${utc(task.updatedAt)}`,
        `SUMMARY:${text((entry.deadline ? "Deadline: " : "") + task.title)}`,
        `URL:${new URL(`/tasks/${encodeURIComponent(workspace.taskKeyPrefix + "-" + task.taskNumber)}`, appUrl).href}`,
      );
      if (task.descriptionMd) lines.push(`DESCRIPTION:${text(task.descriptionMd)}`);
      if (entry.time)
        lines.push(`DTSTART:${utc(toInstant(entry.date, entry.time, entry.timezone))}`);
      else
        lines.push(
          `DTSTART;VALUE=DATE:${dateValue(entry.date)}`,
          `DTEND;VALUE=DATE:${dateValue(addDays(entry.date, 1))}`,
        );
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
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
