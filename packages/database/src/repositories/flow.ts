import type { StatusIntervalRepository } from "@morrowlist/application";
import { and, asc, eq, exists, gte, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client.js";
import { taskStatusIntervals } from "../schema/index.js";

/** Status-interval writer and bulk readers (GAP-17). */

export function createStatusIntervalRepository(db: Database): StatusIntervalRepository {
  // The domain interval excludes storage identity and tenant/project columns.
  const intervalColumns = {
    taskId: taskStatusIntervals.taskId,
    statusId: taskStatusIntervals.statusId,
    category: taskStatusIntervals.category,
    enteredAt: taskStatusIntervals.enteredAt,
    leftAt: taskStatusIntervals.leftAt,
  };

  return {
    async open(interval) {
      await db.insert(taskStatusIntervals).values({
        id: interval.id,
        taskId: interval.taskId,
        workspaceId: interval.workspaceId,
        projectId: interval.projectId,
        statusId: interval.statusId,
        category: interval.category,
        enteredAt: interval.enteredAt,
        leftAt: null,
      });
    },

    async close(taskId, leftAt) {
      await db
        .update(taskStatusIntervals)
        .set({ leftAt })
        .where(
          and(
            eq(taskStatusIntervals.taskId, taskId),
            isNull(taskStatusIntervals.leftAt),
          ),
        );
    },

    async listForTasks(workspaceId, taskIds) {
      if (taskIds.length === 0) return [];
      const rows = await db
        .select(intervalColumns)
        .from(taskStatusIntervals)
        .where(
          and(
            eq(taskStatusIntervals.workspaceId, workspaceId),
            sql`${taskStatusIntervals.taskId} = any(${sql.param(taskIds)}::uuid[])`,
          ),
        )
        .orderBy(asc(taskStatusIntervals.taskId), asc(taskStatusIntervals.enteredAt));
      return rows;
    },

    async listForProject(workspaceId, projectId, since) {
      // A task counts when any of its intervals is still open or was left inside the
      // range; the correlated probe uses the (task_id, entered_at) index, and the whole
      // history of each such task comes back so cycle and lead time can look back.
      const touched = alias(taskStatusIntervals, "touched");
      const rows = await db
        .select(intervalColumns)
        .from(taskStatusIntervals)
        .where(
          and(
            eq(taskStatusIntervals.workspaceId, workspaceId),
            eq(taskStatusIntervals.projectId, projectId),
            exists(
              db
                .select({ one: sql`1` })
                .from(touched)
                .where(
                  and(
                    eq(touched.taskId, taskStatusIntervals.taskId),
                    or(isNull(touched.leftAt), gte(touched.leftAt, since)),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(taskStatusIntervals.taskId), asc(taskStatusIntervals.enteredAt));
      return rows;
    },
  };
}
