import type { StatusIntervalRepository } from "@morrowlist/application";
import type { StatusInterval } from "@morrowlist/domain";
import { and, asc, eq, gte, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "../client.js";
import { taskStatusIntervals } from "../schema/index.js";

/** Status-interval writer and bulk readers (GAP-17). */

export function createStatusIntervalRepository(db: Database): StatusIntervalRepository {
  const toInterval = (
    row: typeof taskStatusIntervals.$inferSelect,
  ): StatusInterval => ({
    taskId: row.taskId,
    statusId: row.statusId,
    category: row.category,
    enteredAt: row.enteredAt,
    leftAt: row.leftAt,
  });

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
        .select()
        .from(taskStatusIntervals)
        .where(
          and(
            eq(taskStatusIntervals.workspaceId, workspaceId),
            inArray(taskStatusIntervals.taskId, [...taskIds]),
          ),
        )
        .orderBy(asc(taskStatusIntervals.taskId), asc(taskStatusIntervals.enteredAt));
      return rows.map(toInterval);
    },

    async listForProject(workspaceId, projectId, since) {
      // Tasks touched in the range, by the project index; then their whole history.
      const touched = db
        .select({ taskId: taskStatusIntervals.taskId })
        .from(taskStatusIntervals)
        .where(
          and(
            eq(taskStatusIntervals.projectId, projectId),
            or(
              isNull(taskStatusIntervals.leftAt),
              gte(taskStatusIntervals.leftAt, since),
            ),
          ),
        );
      const rows = await db
        .select()
        .from(taskStatusIntervals)
        .where(
          and(
            eq(taskStatusIntervals.workspaceId, workspaceId),
            eq(taskStatusIntervals.projectId, projectId),
            inArray(taskStatusIntervals.taskId, touched),
          ),
        )
        .orderBy(asc(taskStatusIntervals.taskId), asc(taskStatusIntervals.enteredAt));
      return rows.map(toInterval);
    },
  };
}
