import type { DayPlan, PlainDate, Task } from "@morrowlist/domain";

/**
 * My Day persistence (spec 9.2). A plan is keyed by task and date, so adding a task to a
 * day twice is a no-op and selections expire simply by the date passing; no midnight job
 * ever mutates them.
 */
export interface DayPlanRepository {
  /** Returns false when the task already has a plan for that date. */
  insert(plan: DayPlan): Promise<boolean>;
  /** Returns false when there was no plan to remove. */
  delete(taskId: string, planDate: PlainDate): Promise<boolean>;
  /** Plan dates on or after `from` for each of the given tasks, ascending, in one query. */
  listForTasks(
    taskIds: readonly string[],
    from: PlainDate,
  ): Promise<ReadonlyMap<string, readonly PlainDate[]>>;
  /**
   * Open, undeleted tasks that were manually selected for `date`, for the next-day review
   * banner. Ordered by task rank.
   */
  listUnfinished(workspaceId: string, date: PlainDate): Promise<readonly Task[]>;
}
