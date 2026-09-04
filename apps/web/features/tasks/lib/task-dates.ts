import type { DateWarning, TaskDto } from "@morrowlist/contracts";

/**
 * Presentation rules for the three task dates (GAP-16). The server decides what is
 * deferred and what the order warnings are; these helpers only decide how a date reads
 * on a row or card, given the calendar date the view is evaluated for.
 */

/** A task is deferred while its defer date is still ahead of `today`. */
export function isDeferred(task: Pick<TaskDto, "deferUntil">, today: string): boolean {
  return task.deferUntil !== null && task.deferUntil > today;
}

export type DeadlineTone = "past" | "soon" | "later";

/**
 * A deadline is loud only when it is close: past, or within the next two calendar days
 * (roughly 48 hours). Anything further away is a plain marker.
 */
export function deadlineTone(deadline: string, today: string): DeadlineTone {
  if (deadline < today) return "past";
  return deadline <= addDays(today, 2) ? "soon" : "later";
}

export const DATE_WARNING_LABELS: Record<DateWarning, string> = {
  defer_after_due: "The defer date is after the planned day.",
  due_after_deadline: "The planned day is after the deadline.",
  defer_after_deadline: "The defer date is after the deadline.",
};

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
