import type { StatusCategory } from "../project/status.js";
import { isTerminalCategory } from "../project/status.js";
import type { Task } from "../task/task.js";
import { addDays, localDateFormatter, type PlainDate } from "../task/values.js";

/**
 * Flow metrics (GAP-17). The four measures the Kanban Guide calls mandatory — work item
 * age, cycle time, throughput and work in progress — plus the cumulative flow and aging
 * charts, all derived from one read model: the intervals a task spent in each workflow
 * status. Every function here is pure; the application layer supplies the intervals and
 * the clock.
 *
 * Durations are milliseconds; the transport converts to days.
 */

export interface StatusInterval {
  readonly taskId: string;
  readonly statusId: string;
  readonly category: StatusCategory;
  readonly enteredAt: Date;
  /** Null while the task is still in the status. */
  readonly leftAt: Date | null;
}

export const DAY_MS = 86_400_000;

/** The percentiles the Flow view reports; the 85th doubles as the "usually done in" hint. */
export const FLOW_PERCENTILES = [50, 85, 95] as const;

/** Work counts as started once it has left the queue: Backlog and Ready are waiting. */
export function isStartedCategory(category: StatusCategory): boolean {
  return category === "in_progress" || category === "blocked" || category === "review";
}

/** Where a task sits on a board, or null for Inbox and trashed tasks. */
export interface BoardPlacement {
  readonly projectId: string;
  readonly statusId: string;
}

export function boardPlacement(task: Task): BoardPlacement | null {
  if (task.deletedAt !== null || task.projectId === null || task.statusId === null) {
    return null;
  }
  return { projectId: task.projectId, statusId: task.statusId };
}

/**
 * What a task change means for its intervals: leaving a placement closes the open
 * interval, arriving at one opens the next. Trashing closes without opening, so trashed
 * work never ages; restoring opens a fresh interval in the status it kept.
 */
export function intervalTransition(
  previous: Task,
  next: Task,
): { readonly closes: boolean; readonly opens: BoardPlacement | null } {
  const before = boardPlacement(previous);
  const after = boardPlacement(next);
  const unchanged =
    before?.projectId === after?.projectId && before?.statusId === after?.statusId;
  if (unchanged) return { closes: false, opens: null };
  return { closes: before !== null, opens: after };
}

function byTime(left: StatusInterval, right: StatusInterval): number {
  const entered = left.enteredAt.getTime() - right.enteredAt.getTime();
  if (entered !== 0) return entered;
  // Two intervals can share an instant when a command both closes and opens; the open
  // one is the later.
  if (left.leftAt === null) return right.leftAt === null ? 0 : 1;
  if (right.leftAt === null) return -1;
  return left.leftAt.getTime() - right.leftAt.getTime();
}

/** Each task's intervals in the order they happened. */
export function intervalsByTask(
  intervals: readonly StatusInterval[],
): Map<string, StatusInterval[]> {
  const grouped = new Map<string, StatusInterval[]>();
  for (const interval of intervals) {
    const list = grouped.get(interval.taskId) ?? [];
    list.push(interval);
    grouped.set(interval.taskId, list);
  }
  for (const list of grouped.values()) list.sort(byTime);
  return grouped;
}

/**
 * The current run: everything since the task last left Done. A reopened task keeps its
 * earlier intervals as history, but its age, cycle time and lead time start over.
 */
export function currentRun(intervals: readonly StatusInterval[]): StatusInterval[] {
  const sorted = [...intervals].sort(byTime);
  let start = 0;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1] as StatusInterval;
    const current = sorted[index] as StatusInterval;
    if (
      isTerminalCategory(previous.category) &&
      !isTerminalCategory(current.category)
    ) {
      start = index;
    }
  }
  return sorted.slice(start);
}

/** First moment the run's work started, or null while it is still queued. */
export function startedAt(run: readonly StatusInterval[]): Date | null {
  return (
    run.find((interval) => isStartedCategory(interval.category))?.enteredAt ?? null
  );
}

/** The moment the run reached Done and stayed there; null for open or trashed work. */
export function doneAt(run: readonly StatusInterval[]): Date | null {
  const last = run.at(-1);
  if (!last || last.leftAt !== null || !isTerminalCategory(last.category)) return null;
  // Done-to-Done moves keep the first Done entry as the completion moment.
  let index = run.length - 1;
  while (index > 0 && isTerminalCategory((run[index - 1] as StatusInterval).category)) {
    index -= 1;
  }
  return (run[index] as StatusInterval).enteredAt;
}

/** Open, on a board, and not done. */
export function isOpenWork(run: readonly StatusInterval[]): boolean {
  const last = run.at(-1);
  return (
    last !== undefined && last.leftAt === null && !isTerminalCategory(last.category)
  );
}

/** Work item age: how long the open item has been started. Null when queued or done. */
export function ageOf(intervals: readonly StatusInterval[], now: Date): number | null {
  const run = currentRun(intervals);
  if (!isOpenWork(run)) return null;
  const started = startedAt(run);
  return started ? now.getTime() - started.getTime() : null;
}

/**
 * Cycle time: from the first started entry to the Done entry of the run, so time spent
 * waiting in Backlog or Ready never counts. Null when the run was never started (moved
 * straight from Ready to Done) or is not done.
 */
export function cycleTime(intervals: readonly StatusInterval[]): number | null {
  const run = currentRun(intervals);
  const done = doneAt(run);
  const started = startedAt(run);
  if (done === null || started === null) return null;
  return done.getTime() - started.getTime();
}

/** Lead time: from the run's first status (creation, or reopening) to Done. */
export function leadTime(intervals: readonly StatusInterval[]): number | null {
  const run = currentRun(intervals);
  const done = doneAt(run);
  const first = run[0];
  if (done === null || !first) return null;
  return done.getTime() - first.enteredAt.getTime();
}

/**
 * Nearest-rank percentiles: the value at position ceil(p/100 · n), so a percentile is
 * always one of the samples and ties need no interpolation. Empty input gives no entries.
 */
export function percentiles(
  values: readonly number[],
  requested: readonly number[] = FLOW_PERCENTILES,
): Map<number, number> {
  const result = new Map<number, number>();
  if (values.length === 0) return result;
  const sorted = [...values].sort((left, right) => left - right);
  for (const percentile of requested) {
    const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
    result.set(percentile, sorted[rank - 1] as number);
  }
  return result;
}

export interface DateRange {
  readonly from: PlainDate;
  readonly to: PlainDate;
}

function dayOffset(from: PlainDate, date: PlainDate): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** The Monday on or before a date. */
export function startOfWeek(date: PlainDate): PlainDate {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export interface WeekBucket {
  readonly weekStart: PlainDate;
  readonly count: number;
}

/**
 * Completions per calendar week (Monday start) in the workspace's timezone, zero-filled
 * across the range so an idle week shows as a gap rather than disappearing.
 */
export function throughputByWeek(
  completions: readonly Date[],
  range: DateRange,
  timezone: string,
): WeekBucket[] {
  const localDate = localDateFormatter(timezone);
  const counts = new Map<PlainDate, number>();
  for (let week = startOfWeek(range.from); week <= range.to; week = addDays(week, 7)) {
    counts.set(week, 0);
  }
  for (const completion of completions) {
    const date = localDate(completion);
    if (date < range.from || date > range.to) continue;
    const week = startOfWeek(date);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  return [...counts.entries()].map(([weekStart, count]) => ({ weekStart, count }));
}

export type CategoryCounts = Readonly<Record<StatusCategory, number>>;

export interface FlowDay {
  readonly date: PlainDate;
  readonly counts: CategoryCounts;
}

const CATEGORIES: readonly StatusCategory[] = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
];

/**
 * Cumulative flow: for each day in the range, how many tasks ended the day in each
 * category. A task is in the status it entered on or before the day and had not left by
 * the day's end (a status left the same day it was entered does not count).
 */
export function cumulativeFlow(
  intervals: readonly StatusInterval[],
  range: DateRange,
  timezone: string,
): FlowDay[] {
  const localDate = localDateFormatter(timezone);
  const days = dayOffset(range.from, range.to) + 1;
  if (days <= 0) return [];

  // Difference arrays: O(intervals + days) rather than O(intervals × days).
  const deltas = new Map<StatusCategory, Int32Array>(
    CATEGORIES.map((category) => [category, new Int32Array(days + 1)]),
  );
  for (const interval of intervals) {
    const start = Math.max(0, dayOffset(range.from, localDate(interval.enteredAt)));
    const end =
      interval.leftAt === null
        ? days
        : Math.min(days, dayOffset(range.from, localDate(interval.leftAt)));
    if (start >= end) continue;
    const delta = deltas.get(interval.category) as Int32Array;
    delta[start] = (delta[start] ?? 0) + 1;
    delta[end] = (delta[end] ?? 0) - 1;
  }

  const result: FlowDay[] = [];
  const running = new Map<StatusCategory, number>(CATEGORIES.map((c) => [c, 0]));
  for (let day = 0; day < days; day++) {
    const counts: Record<string, number> = {};
    for (const category of CATEGORIES) {
      const next =
        (running.get(category) ?? 0) + ((deltas.get(category) as Int32Array)[day] ?? 0);
      running.set(category, next);
      counts[category] = next;
    }
    result.push({ date: addDays(range.from, day), counts: counts as CategoryCounts });
  }
  return result;
}

/** Which reference the item's age has passed: none, the 50th, 85th or 95th percentile. */
export type AgingBand = "under_p50" | "over_p50" | "over_p85" | "over_p95";

export interface AgingItem {
  readonly taskId: string;
  readonly statusId: string;
  readonly category: StatusCategory;
  /** Milliseconds since the item was started. */
  readonly age: number;
  /** Null when there is no completed work to compare against yet. */
  readonly band: AgingBand | null;
}

/**
 * Aging work in progress: every started, open item with its age and the cycle-time
 * percentile it has crossed, oldest first. Queued work is not aging yet.
 */
export function agingWip(
  intervals: readonly StatusInterval[],
  now: Date,
  reference: ReadonlyMap<number, number>,
): AgingItem[] {
  const items: AgingItem[] = [];
  for (const [taskId, taskIntervals] of intervalsByTask(intervals)) {
    const age = ageOf(taskIntervals, now);
    if (age === null) continue;
    const current = currentRun(taskIntervals).at(-1) as StatusInterval;
    items.push({
      taskId,
      statusId: current.statusId,
      category: current.category,
      age,
      band: agingBand(age, reference),
    });
  }
  return items.sort((left, right) => right.age - left.age);
}

export function agingBand(
  age: number,
  reference: ReadonlyMap<number, number>,
): AgingBand | null {
  const p50 = reference.get(50);
  if (p50 === undefined) return null;
  const p95 = reference.get(95) ?? Number.POSITIVE_INFINITY;
  const p85 = reference.get(85) ?? Number.POSITIVE_INFINITY;
  if (age > p95) return "over_p95";
  if (age > p85) return "over_p85";
  if (age > p50) return "over_p50";
  return "under_p50";
}
