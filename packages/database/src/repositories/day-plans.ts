import type { DayPlanRepository } from "@morrowlist/application";
import type { PlainDate } from "@morrowlist/domain";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { taskDayPlans, tasks } from "../schema/index.js";

import { toTask } from "./mappers.js";

/**
 * My Day persistence (TASK-007). The composite key on (task_id, plan_date) is what makes
 * adding a task to a day idempotent; selections expire because they are date-bound, not
 * because anything deletes them (spec 9.2).
 */
export function createDayPlanRepository(db: Database): DayPlanRepository {
  return {
    async insert(plan) {
      const inserted = await db
        .insert(taskDayPlans)
        .values({
          taskId: plan.taskId,
          planDate: plan.planDate,
          source: plan.source,
          createdByActorKind: plan.createdBy.kind,
          createdByActorId: plan.createdBy.id,
          createdAt: plan.createdAt,
        })
        .onConflictDoNothing({ target: [taskDayPlans.taskId, taskDayPlans.planDate] })
        .returning({ taskId: taskDayPlans.taskId });
      return inserted.length === 1;
    },

    async delete(taskId, planDate) {
      const removed = await db
        .delete(taskDayPlans)
        .where(
          and(eq(taskDayPlans.taskId, taskId), eq(taskDayPlans.planDate, planDate)),
        )
        .returning({ taskId: taskDayPlans.taskId });
      return removed.length === 1;
    },

    async listForTasks(taskIds, from) {
      const result = new Map<string, PlainDate[]>();
      if (taskIds.length === 0) return result;

      const rows = await db
        .select({ taskId: taskDayPlans.taskId, planDate: taskDayPlans.planDate })
        .from(taskDayPlans)
        .where(
          and(
            sql`${taskDayPlans.taskId} = any(${sql.param(taskIds)}::uuid[])`,
            gte(taskDayPlans.planDate, from),
          ),
        )
        .orderBy(asc(taskDayPlans.planDate));

      for (const row of rows) {
        const dates = result.get(row.taskId) ?? [];
        dates.push(row.planDate as PlainDate);
        result.set(row.taskId, dates);
      }
      return result;
    },

    async listUnfinished(workspaceId, date) {
      const rows = await db
        .select({ task: tasks })
        .from(taskDayPlans)
        .innerJoin(tasks, eq(tasks.id, taskDayPlans.taskId))
        .where(
          and(
            eq(taskDayPlans.planDate, date),
            eq(taskDayPlans.source, "manual"),
            eq(tasks.workspaceId, workspaceId),
            isNull(tasks.deletedAt),
            isNull(tasks.completedAt),
          ),
        )
        .orderBy(asc(tasks.rank), asc(tasks.id));
      return rows.map((row) => toTask(row.task));
    },
  };
}
