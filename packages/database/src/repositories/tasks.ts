import type {
  Cursor,
  Page,
  RankScope,
  TaskCounterRepository,
  TaskFilter,
  TaskRepository,
} from "@morrowlist/application";
import type { Task } from "@morrowlist/domain";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { tasks, workspaceTaskCounters } from "../schema/index.js";

import { toTask, toTaskRow } from "./mappers.js";

/** Drizzle implementation of the task ports (TASK-003). */

const PRIORITY_RANK = sql`
  case ${tasks.priority}
    when 'urgent' then 4
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else 0
  end
`;

export function createTaskRepository(db: Database): TaskRepository {
  const scopePredicate = (scope: RankScope) =>
    and(
      eq(tasks.workspaceId, scope.workspaceId),
      scope.projectId === null
        ? isNull(tasks.projectId)
        : eq(tasks.projectId, scope.projectId),
      scope.statusId === null
        ? isNull(tasks.statusId)
        : eq(tasks.statusId, scope.statusId),
      isNull(tasks.deletedAt),
    );

  return {
    async findById(workspaceId, taskId) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId)))
        .limit(1);
      return row ? toTask(row) : null;
    },

    async findByNumber(workspaceId, taskNumber) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.workspaceId, workspaceId), eq(tasks.taskNumber, taskNumber)),
        )
        .limit(1);
      return row ? toTask(row) : null;
    },

    async list(filter: TaskFilter, cursor: Cursor): Promise<Page<Task>> {
      const conditions = [eq(tasks.workspaceId, filter.workspaceId)];

      if (!filter.includeDeleted) conditions.push(isNull(tasks.deletedAt));
      if (filter.inboxOnly) conditions.push(isNull(tasks.projectId));
      if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId));
      if (filter.statusId) conditions.push(eq(tasks.statusId, filter.statusId));
      if (filter.priority) conditions.push(eq(tasks.priority, filter.priority));
      if (filter.parentTaskId) {
        conditions.push(eq(tasks.parentTaskId, filter.parentTaskId));
      } else if (filter.includeSubtasks === false) {
        conditions.push(isNull(tasks.parentTaskId));
      }
      if (filter.isCompleted !== undefined) {
        conditions.push(
          filter.isCompleted ? isNotNull(tasks.completedAt) : isNull(tasks.completedAt),
        );
      }
      if (filter.due && filter.today) {
        const today = filter.today;
        if (filter.due === "none") conditions.push(isNull(tasks.dueDate));
        if (filter.due === "overdue") conditions.push(lt(tasks.dueDate, today));
        if (filter.due === "today") conditions.push(eq(tasks.dueDate, today));
        if (filter.due === "future") conditions.push(gt(tasks.dueDate, today));
      }

      const descending = filter.order === "desc";
      const direction = descending ? desc : asc;
      const sortColumn = (() => {
        switch (filter.sort) {
          case "createdAt":
            return tasks.createdAt;
          case "updatedAt":
            return tasks.updatedAt;
          case "dueDate":
            return tasks.dueDate;
          case "priority":
            return PRIORITY_RANK;
          default:
            return tasks.rank;
        }
      })();

      // Keyset pagination: `id` breaks ties so a page boundary cannot skip or repeat a
      // row when two tasks share a sort key.
      if (cursor.after) {
        const [anchor] = await db
          .select()
          .from(tasks)
          .where(eq(tasks.id, cursor.after))
          .limit(1);
        if (anchor) {
          const anchorRow = toTask(anchor);
          conditions.push(
            descending
              ? sql`(${sortColumn}, ${tasks.id}) < (${sortKeyOf(anchorRow, filter.sort)}, ${anchorRow.id})`
              : sql`(${sortColumn}, ${tasks.id}) > (${sortKeyOf(anchorRow, filter.sort)}, ${anchorRow.id})`,
          );
        }
      }

      // Fetch one extra row to decide `hasMore` without a second count query.
      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(direction(sortColumn), direction(tasks.id))
        .limit(cursor.limit + 1);

      const hasMore = rows.length > cursor.limit;
      return {
        items: rows.slice(0, cursor.limit).map(toTask),
        hasMore,
        nextCursor: null,
      };
    },

    async insert(task) {
      await db.insert(tasks).values(toTaskRow(task));
    },

    async update(task, previousVersion) {
      const result = await db
        .update(tasks)
        .set(toTaskRow(task))
        .where(and(eq(tasks.id, task.id), eq(tasks.version, previousVersion)))
        .returning({ id: tasks.id });
      return result.length === 1;
    },

    async hardDelete(workspaceId, taskId) {
      await db
        .delete(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId)));
    },

    async firstRankIn(scope) {
      const [row] = await db
        .select({ rank: tasks.rank })
        .from(tasks)
        .where(scopePredicate(scope))
        .orderBy(asc(tasks.rank))
        .limit(1);
      return row?.rank ?? null;
    },

    async lastRankIn(scope) {
      const [row] = await db
        .select({ rank: tasks.rank })
        .from(tasks)
        .where(scopePredicate(scope))
        .orderBy(desc(tasks.rank))
        .limit(1);
      return row?.rank ?? null;
    },

    async ranksOf(workspaceId, taskIds) {
      if (taskIds.length === 0) return new Map();
      const rows = await db
        .select({ id: tasks.id, rank: tasks.rank })
        .from(tasks)
        .where(
          and(eq(tasks.workspaceId, workspaceId), inArray(tasks.id, [...taskIds])),
        );
      return new Map(rows.map((row) => [row.id, row.rank]));
    },

    async ancestorIds(workspaceId, taskId) {
      // One recursive query rather than a loop of round trips (spec 29.3). The depth cap
      // is a guard against a cycle that predates the application-level check.
      const result = await db.execute<{ id: string }>(sql`
        with recursive chain as (
          select t.id, t.parent_task_id, 1 as depth
          from ${tasks} t
          where t.id = ${taskId} and t.workspace_id = ${workspaceId}
          union all
          select p.id, p.parent_task_id, chain.depth + 1
          from ${tasks} p
          join chain on p.id = chain.parent_task_id
          where chain.depth < 16 and p.workspace_id = ${workspaceId}
        )
        select id from chain where id <> ${taskId} order by depth
      `);
      return result.rows.map((row) => row.id);
    },
  };
}

function sortKeyOf(task: Task, sort: TaskFilter["sort"]) {
  switch (sort) {
    case "createdAt":
      return task.createdAt;
    case "updatedAt":
      return task.updatedAt;
    case "dueDate":
      return task.dueDate;
    case "priority":
      return sql`case ${task.priority}
        when 'urgent' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1
        else 0 end`;
    default:
      return task.rank;
  }
}

export function createTaskCounterRepository(db: Database): TaskCounterRepository {
  return {
    async ensure(workspaceId) {
      await db
        .insert(workspaceTaskCounters)
        .values({ workspaceId, nextNumber: 1 })
        .onConflictDoNothing();
    },

    async allocate(workspaceId) {
      // A single atomic upsert: the row is created on first use and incremented under a
      // row lock, so concurrent creates in the same workspace cannot share a number.
      const result = await db.execute<{ next_number: string }>(sql`
        insert into ${workspaceTaskCounters} (workspace_id, next_number)
        values (${workspaceId}, 2)
        on conflict (workspace_id)
        do update set next_number = ${workspaceTaskCounters}.next_number + 1
        returning next_number
      `);

      const raw = result.rows[0]?.next_number;
      if (raw === undefined) {
        throw new Error(`failed to allocate a task number for workspace ${workspaceId}`);
      }
      // `next_number` is the value *after* the increment, so the allocated number is one
      // less. The insert branch seeds 2 and therefore allocates 1.
      return Number(raw) - 1;
    },
  };
}
