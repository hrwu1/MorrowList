import type { CalendarViewResponse, TaskDto } from "@morrowlist/contracts";

export const calendarKeys = {
  all: ["views", "calendar"] as const,
  view: (from: string, to: string) => ["views", "calendar", from, to] as const,
};
export type CalendarLayout = "month" | "week";
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function validCalendarDate(date: string | null): date is string {
  return Boolean(
    date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number(date.slice(0, 4)) >= 100 &&
      Number(date.slice(0, 4)) <= 9998 &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(`${date}T12:00:00Z`).toISOString().startsWith(date),
  );
}
export function calendarDays(anchor: string, layout: CalendarLayout): string[] {
  const first = layout === "month" ? `${anchor.slice(0, 7)}-01` : anchor;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = shiftDate(first, -weekday);
  const count = layout === "week" ? 7 : 42;
  return Array.from({ length: count }, (_, index) => shiftDate(start, index));
}
export function shiftPeriod(
  anchor: string,
  layout: CalendarLayout,
  direction: number,
): string {
  if (layout === "week") return shiftDate(anchor, direction * 7);
  const value = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + direction);
  return value.toISOString().slice(0, 10);
}
export function calendarLabel(date: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}
export function taskOnDate(task: TaskDto, date: string): boolean {
  return (
    !task.isCompleted &&
    task.deletedAt === null &&
    [task.dueDate, task.deadline, task.deferUntil].includes(date)
  );
}
export function patchTaskInCalendar(
  current: CalendarViewResponse,
  task: TaskDto,
): CalendarViewResponse {
  const belongs =
    !task.isCompleted &&
    task.deletedAt === null &&
    [task.dueDate, task.deadline, task.deferUntil].some(
      (date) => date !== null && date >= current.data.from && date <= current.data.to,
    );
  const existed = current.data.tasks.some((candidate) => candidate.id === task.id);
  const tasks = current.data.tasks.flatMap((candidate) =>
    candidate.id !== task.id ? [candidate] : belongs ? [task] : [],
  );
  // A truncated projection cannot safely be widened; refetch resolves its boundary.
  if (belongs && !existed && !current.data.truncated) tasks.push(task);
  return { data: { ...current.data, tasks } };
}
