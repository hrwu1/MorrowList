import type { ActorRef } from "../shared/actor.js";

import { isCompleted, isDeferred, isDeleted, type Task } from "./task.js";
import { addDays, type PlainDate } from "./values.js";

/**
 * Today and Upcoming projections (spec 9.2, 9.3). Both are pure: the application layer
 * loads the candidate tasks and day plans, and these functions decide where each task
 * shows and why. Today membership is a dated relation on the canonical task, never a
 * copy of it (ADR-001).
 */

export const DAY_PLAN_SOURCES = ["manual", "capture"] as const;
export type DayPlanSource = (typeof DAY_PLAN_SOURCES)[number];

/** One My Day selection: a task chosen for a date (spec 8.1 `task_day_plans`). */
export interface DayPlan {
  readonly taskId: string;
  readonly planDate: PlainDate;
  readonly source: DayPlanSource;
  readonly createdBy: ActorRef;
  readonly createdAt: Date;
}

/** Why a task is in Today, in grouping precedence order (spec 9.2). */
export const TODAY_REASONS = ["overdue", "due_today", "my_day"] as const;
export type TodayReason = (typeof TODAY_REASONS)[number];

export interface TodayEntry {
  readonly task: Task;
  /** Every applicable reason, so the row can badge all of them (spec 9.2). */
  readonly reasons: readonly TodayReason[];
}

export interface TodaySection {
  readonly id: TodayReason;
  readonly tasks: readonly TodayEntry[];
}

/**
 * Which of the Today conditions an open task satisfies on `today`. A deferred task is out
 * of sight until its defer date (GAP-16): only a deliberate My Day selection brings it in,
 * and then only as My Day, never as overdue or due today.
 */
export function todayReasons(
  task: Task,
  plannedToday: boolean,
  today: PlainDate,
): TodayReason[] {
  if (isDeferred(task, today)) return plannedToday ? ["my_day"] : [];
  const reasons: TodayReason[] = [];
  if (task.dueDate !== null && task.dueDate < today) reasons.push("overdue");
  if (task.dueDate === today) reasons.push("due_today");
  if (plannedToday) reasons.push("my_day");
  return reasons;
}

/**
 * The de-duplicated union of overdue, due-today, and My Day tasks (spec 9.2). A task
 * appears once, in the highest-precedence section it qualifies for, with badges for every
 * reason. Completed and deleted tasks never appear: completion follows the global rules
 * (spec 8.5) and removes the task from Today's incomplete sections.
 */
export function todaySections(
  tasks: readonly Task[],
  plannedTaskIds: ReadonlySet<string>,
  today: PlainDate,
): TodaySection[] {
  const buckets = new Map<TodayReason, TodayEntry[]>(
    TODAY_REASONS.map((reason) => [reason, []]),
  );

  for (const task of tasks) {
    if (isCompleted(task) || isDeleted(task)) continue;
    const reasons = todayReasons(task, plannedTaskIds.has(task.id), today);
    const primary = reasons[0];
    if (!primary) continue;
    buckets.get(primary)?.push({ task, reasons });
  }

  return TODAY_REASONS.map((id) => ({
    id,
    tasks: [...(buckets.get(id) ?? [])].sort(id === "overdue" ? byDueThenRank : byRank),
  }));
}

/**
 * Due-date buckets a board can be pivoted by (GAP-19), soonest first. They are coarse on
 * purpose: a swimlane is a glance at urgency, and Upcoming already groups by exact date.
 */
export const DUE_BUCKETS = ["overdue", "today", "soon", "later", "none"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

/** `soon` is the next seven days after today, matching the deadline filter's week. */
export function dueBucket(dueDate: PlainDate | null, today: PlainDate): DueBucket {
  if (dueDate === null) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return dueDate <= addDays(today, 7) ? "soon" : "later";
}

export interface UpcomingGroup {
  readonly date: PlainDate;
  readonly tasks: readonly Task[];
}

/**
 * Open tasks due after `from`, grouped by due date in chronological order (spec 9.3). A
 * null horizon means every future date. Within a day, date-only tasks come first, then
 * timed tasks by time, so nothing is given an artificial midnight. A task deferred past
 * `from` is left out until its defer date, like in Today (GAP-16).
 */
export function upcomingGroups(
  tasks: readonly Task[],
  from: PlainDate,
  horizonDays: number | null,
): UpcomingGroup[] {
  const last = horizonDays === null ? null : addDays(from, horizonDays);
  const byDate = new Map<PlainDate, Task[]>();

  for (const task of tasks) {
    if (isCompleted(task) || isDeleted(task) || task.dueDate === null) continue;
    if (task.dueDate <= from || isDeferred(task, from)) continue;
    if (last !== null && task.dueDate > last) continue;
    const group = byDate.get(task.dueDate) ?? [];
    group.push(task);
    byDate.set(task.dueDate, group);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([date, group]) => ({ date, tasks: group.sort(byTimeThenRank) }));
}

function byRank(left: TodayEntry, right: TodayEntry): number {
  return (
    compare(left.task.rank, right.task.rank) || compare(left.task.id, right.task.id)
  );
}

function byDueThenRank(left: TodayEntry, right: TodayEntry): number {
  return (
    compare(left.task.dueDate ?? "", right.task.dueDate ?? "") || byRank(left, right)
  );
}

function byTimeThenRank(left: Task, right: Task): number {
  return (
    compare(left.dueTime ?? "", right.dueTime ?? "") ||
    compare(left.rank, right.rank) ||
    compare(left.id, right.id)
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
