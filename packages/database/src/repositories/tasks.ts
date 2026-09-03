import {
  BLOCKS_WALK_DEPTH,
  BOARD_TASK_LIMIT,
  UPCOMING_LIMIT,
  type BoardTaskPage,
  type Cursor,
  type Page,
  type RankScope,
  type RelationEdge,
  type TaskCounterRepository,
  type TaskFilter,
  type TaskRepository,
} from "@morrowlist/application";
import type { ChildProgress, Tag, Task } from "@morrowlist/domain";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "../client.js";
import {
  tags,
  taskDayPlans,
  taskRelations,
  taskTags,
  tasks,
  workflowStatuses,
  workspaceTaskCounters,
} from "../schema/index.js";

import {
  toTag,
  toTask,
  toTaskRelation,
  toTaskRelationRow,
  toTaskRow,
} from "./mappers.js";

/** Drizzle implementation of the task ports (TASK-003). */

/**
 * The blocked predicate as the domain defines it (spec 8.4): open, and either flagged
 * or waiting on a live, incomplete `blocks` predecessor. The self-join is aliased by
 * name because Drizzle's `exists` needs a table reference distinct from the outer one.
 */
const BLOCKED = sql`(
  ${tasks.completedAt} is null and (
    ${tasks.blockedReason} is not null or exists (
      select 1 from ${taskRelations} r
      join ${tasks} p on p.id = r.source_task_id
      where r.target_task_id = ${tasks.id}
        and r.type = 'blocks'
        and p.completed_at is null
        and p.deleted_at is null
    )
  )
)`;

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

      conditions.push(
        filter.deletedOnly ? isNotNull(tasks.deletedAt) : isNull(tasks.deletedAt),
      );
      if (filter.inboxOnly) conditions.push(isNull(tasks.projectId));
      if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId));
      if (filter.statusId) conditions.push(eq(tasks.statusId, filter.statusId));
      if (filter.priority) conditions.push(eq(tasks.priority, filter.priority));
      if (filter.tagId) {
        conditions.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(taskTags)
              .where(
                and(eq(taskTags.taskId, tasks.id), eq(taskTags.tagId, filter.tagId)),
              ),
          ),
        );
      }
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
      if (filter.isBlocked !== undefined) {
        conditions.push(filter.isBlocked ? BLOCKED : sql`not ${BLOCKED}`);
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

    async listBoard(query): Promise<BoardTaskPage> {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
      );

      // The joined status rank makes this one bounded data query for the complete board,
      // rather than one task request per lane. Archived statuses are excluded because they
      // are not board columns and therefore cannot safely receive or display live work.
      const rows = await db
        .select({ task: tasks })
        .from(tasks)
        .innerJoin(workflowStatuses, eq(workflowStatuses.id, tasks.statusId))
        .where(
          and(
            eq(tasks.workspaceId, query.workspaceId),
            eq(tasks.projectId, query.projectId),
            isNull(tasks.deletedAt),
            query.includeSubtasks ? undefined : isNull(tasks.parentTaskId),
            eq(workflowStatuses.projectId, query.projectId),
            isNull(workflowStatuses.archivedAt),
          ),
        )
        .orderBy(asc(workflowStatuses.rank), asc(tasks.rank), asc(tasks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      return {
        items: rows.slice(0, limit).map((row) => toTask(row.task)),
        hasMore,
        truncated: hasMore,
      };
    },

    async listToday(query): Promise<BoardTaskPage> {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? BOARD_TASK_LIMIT, BOARD_TASK_LIMIT),
      );

      // One query for the whole day: the due-date predicate uses tasks_due_idx and the
      // plan lookup uses task_day_plans_date_idx, so Today stays flat as the workspace
      // grows (spec 9.2, the 300 ms budget).
      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, query.workspaceId),
            isNull(tasks.deletedAt),
            isNull(tasks.completedAt),
            or(
              lte(tasks.dueDate, query.date),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(taskDayPlans)
                  .where(
                    and(
                      eq(taskDayPlans.taskId, tasks.id),
                      eq(taskDayPlans.planDate, query.date),
                    ),
                  ),
              ),
            ),
          ),
        )
        .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.rank), asc(tasks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map(toTask), hasMore, truncated: hasMore };
    },

    async listUpcoming(query): Promise<BoardTaskPage> {
      const limit = Math.max(
        1,
        Math.min(query.limit ?? UPCOMING_LIMIT, UPCOMING_LIMIT),
      );
      const conditions = [
        eq(tasks.workspaceId, query.workspaceId),
        isNull(tasks.deletedAt),
        isNull(tasks.completedAt),
        gt(tasks.dueDate, query.from),
      ];
      if (query.to !== null) conditions.push(lte(tasks.dueDate, query.to));

      const rows = await db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.dueDate), asc(tasks.rank), asc(tasks.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      return { items: rows.slice(0, limit).map(toTask), hasMore, truncated: hasMore };
    },

    async listInStatus(workspaceId, statusId) {
      // Trashed tasks are included on purpose: this feeds the archive of a column, which
      // has to carry every task that still references it (spec 8.6).
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.statusId, statusId)))
        .orderBy(asc(tasks.rank), asc(tasks.id));
      return rows.map(toTask);
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

    async descendantDepth(workspaceId, taskId) {
      // Deleted descendants count: restoring one must never yield a tree over the limit.
      const result = await db.execute<{ depth: number | string }>(sql`
        with recursive subtree as (
          select t.id, 0 as depth
          from ${tasks} t
          where t.id = ${taskId} and t.workspace_id = ${workspaceId}
          union all
          select c.id, subtree.depth + 1
          from ${tasks} c
          join subtree on c.parent_task_id = subtree.id
          where subtree.depth < 16 and c.workspace_id = ${workspaceId}
        )
        select coalesce(max(depth), 0) as depth from subtree
      `);
      return Number(result.rows[0]?.depth ?? 0);
    },

    async childSummary(workspaceId, taskIds) {
      if (taskIds.length === 0) return new Map();
      const rows = await db
        .select({
          parentTaskId: tasks.parentTaskId,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(${tasks.completedAt})::int`,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, workspaceId),
            inArray(tasks.parentTaskId, [...taskIds]),
            isNull(tasks.deletedAt),
          ),
        )
        .groupBy(tasks.parentTaskId);
      return new Map<string, ChildProgress>(
        rows.flatMap((row) =>
          row.parentTaskId
            ? [[row.parentTaskId, { completed: row.completed, total: row.total }]]
            : [],
        ),
      );
    },

    async tagsFor(workspaceId, taskIds) {
      const result = new Map<string, Tag[]>();
      if (taskIds.length === 0) return result;
      // One query for the whole page (spec 29.3). normalized_name is COLLATE "C", so the
      // order is by code point and matches the in-memory double.
      const rows = await db
        .select({ taskId: taskTags.taskId, tag: tags })
        .from(taskTags)
        .innerJoin(tags, eq(tags.id, taskTags.tagId))
        .where(
          and(
            eq(tags.workspaceId, workspaceId),
            inArray(taskTags.taskId, [...taskIds]),
          ),
        )
        .orderBy(asc(tags.normalizedName), asc(tags.id));
      for (const row of rows) {
        const list = result.get(row.taskId) ?? [];
        list.push(toTag(row.tag));
        result.set(row.taskId, list);
      }
      return result;
    },

    async addTag(taskId, tagId, createdAt) {
      await db
        .insert(taskTags)
        .values({ taskId, tagId, createdAt })
        .onConflictDoNothing();
    },

    async removeTag(taskId, tagId) {
      await db
        .delete(taskTags)
        .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)));
    },

    async relationsFor(workspaceId, taskIds) {
      if (taskIds.length === 0) return [];
      // One query for the page (spec 29.3): the relation plus both endpoint rows, so
      // the caller can show the other task and evaluate its completion state.
      const source = alias(tasks, "source_task");
      const target = alias(tasks, "target_task");
      const ids = [...taskIds];
      const rows = await db
        .select({ relation: taskRelations, source, target })
        .from(taskRelations)
        .innerJoin(source, eq(source.id, taskRelations.sourceTaskId))
        .innerJoin(target, eq(target.id, taskRelations.targetTaskId))
        .where(
          and(
            eq(taskRelations.workspaceId, workspaceId),
            or(
              inArray(taskRelations.sourceTaskId, ids),
              inArray(taskRelations.targetTaskId, ids),
            ),
          ),
        )
        .orderBy(asc(taskRelations.createdAt), asc(taskRelations.id));
      return rows.map(
        (row): RelationEdge => ({
          relation: toTaskRelation(row.relation),
          source: toTask(row.source),
          target: toTask(row.target),
        }),
      );
    },

    async findRelation(workspaceId, relationId) {
      const [row] = await db
        .select()
        .from(taskRelations)
        .where(
          and(
            eq(taskRelations.workspaceId, workspaceId),
            eq(taskRelations.id, relationId),
          ),
        )
        .limit(1);
      return row ? toTaskRelation(row) : null;
    },

    async insertRelation(relation) {
      const inserted = await db
        .insert(taskRelations)
        .values(toTaskRelationRow(relation))
        .onConflictDoNothing({
          target: [
            taskRelations.sourceTaskId,
            taskRelations.targetTaskId,
            taskRelations.type,
          ],
        })
        .returning({ id: taskRelations.id });
      return inserted.length === 1;
    },

    async deleteRelation(workspaceId, relationId) {
      await db
        .delete(taskRelations)
        .where(
          and(
            eq(taskRelations.workspaceId, workspaceId),
            eq(taskRelations.id, relationId),
          ),
        );
    },

    async downstreamOf(workspaceId, taskId, type) {
      // A bounded recursive walk along source → target edges; the depth cap guards
      // against a cycle that predates the application-level check.
      const result = await db.execute<{ id: string }>(sql`
        with recursive downstream as (
          select r.target_task_id as id, 1 as depth
          from ${taskRelations} r
          where r.source_task_id = ${taskId}
            and r.workspace_id = ${workspaceId}
            and r.type = ${type}
          union
          select r.target_task_id, downstream.depth + 1
          from ${taskRelations} r
          join downstream on r.source_task_id = downstream.id
          where downstream.depth < ${BLOCKS_WALK_DEPTH}
            and r.workspace_id = ${workspaceId}
            and r.type = ${type}
        )
        select distinct id from downstream
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
        throw new Error(
          `failed to allocate a task number for workspace ${workspaceId}`,
        );
      }
      // `next_number` is the value *after* the increment, so the allocated number is one
      // less. The insert branch seeds 2 and therefore allocates 1.
      return Number(raw) - 1;
    },
  };
}
