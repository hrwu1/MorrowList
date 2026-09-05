import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { actorKindEnum, priorityEnum, relationTypeEnum } from "./enums.js";
import { projects, workflowStatuses } from "./project.js";
import { workspaces } from "./workspace.js";

/** The canonical task table (spec 18.2). Every projection reads from here. */

/** Drizzle has no tsvector column; the generated expression lives in migration 0004. */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskNumber: bigint("task_number", { mode: "number" }).notNull(),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    statusId: uuid("status_id").references(() => workflowStatuses.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 500 }).notNull(),
    descriptionMd: text("description_md"),
    priority: priorityEnum("priority").notNull().default("none"),
    dueDate: date("due_date"),
    dueTime: time("due_time"),
    dueTimezone: varchar("due_timezone", { length: 100 }),
    // Start/defer and deadline dates (GAP-16, migration 0009). Date-only like due_date;
    // the deadline time is wall-clock in the workspace timezone.
    deferUntil: date("defer_until"),
    deadline: date("deadline"),
    deadlineTime: time("deadline_time"),
    // Null means no reminder; the schedule itself lives in task_reminders (GAP-13).
    reminderOffsetMinutes: integer("reminder_offset_minutes"),
    // Drizzle cannot infer a self-referencing foreign key: the callback's return type
    // depends on the table being declared. The annotation breaks that cycle.
    parentTaskId: uuid("parent_task_id").references(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (): any => tasks.id,
      { onDelete: "set null" },
    ),
    // A recurrence rule as canonical JSON (GAP-12); validated by the contract and the
    // domain before it is written, so the column itself stays schemaless.
    recurrence: jsonb("recurrence"),
    // The first occurrence's id, shared by every task in one repeating series.
    seriesId: uuid("series_id"),
    // Typed custom-field values keyed by the definition's key (GAP-24). A slot on the
    // canonical task, indexed with GIN so an equality filter is an index scan.
    fields: jsonb("fields").notNull().default({}),
    // COLLATE "C" is applied in the migration; see domain/shared/rank.ts for why.
    rank: varchar("rank", { length: 64 }).notNull(),
    // The COLLATE "C" clause itself lives in migration 0001; Drizzle does not model
    // column collation, so the migration is the source of truth for it.
    lastActiveStatusId: uuid("last_active_status_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // The explicit blocker flag (spec 8.4, GAP-06); added in migration 0005.
    blockedReason: text("blocked_reason"),
    blockedSince: timestamp("blocked_since", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdByActorKind: actorKindEnum("created_by_actor_kind").notNull(),
    createdByActorId: varchar("created_by_actor_id", { length: 200 }).notNull(),
    lastActorKind: actorKindEnum("last_actor_kind").notNull(),
    lastActorId: varchar("last_actor_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByActorKind: actorKindEnum("deleted_by_actor_kind"),
    deletedByActorId: varchar("deleted_by_actor_id", { length: 200 }),
    // Full-text search over the title (weight A) and description (weight B) in the
    // 'simple' configuration, so a word matches the same way in every language (spec
    // 9.8). Stored and generated: it is never written by the application.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', coalesce("description_md", '')), 'B')`,
    ),
  },
  (table) => [
    uniqueIndex("tasks_workspace_number_key").on(table.workspaceId, table.taskNumber),
    index("tasks_search_idx").using("gin", table.searchVector),
    index("tasks_fields_idx").using("gin", table.fields),
    index("tasks_workspace_state_idx").on(
      table.workspaceId,
      table.deletedAt,
      table.completedAt,
    ),
    index("tasks_board_idx").on(table.projectId, table.statusId, table.rank),
    index("tasks_due_idx").on(table.workspaceId, table.dueDate),
    index("tasks_parent_idx").on(table.parentTaskId),
    index("tasks_series_idx").on(table.workspaceId, table.seriesId),
    // Live, open rows with a defer date or a deadline: what the deferred and deadline
    // filters and the Today/Upcoming predicates touch (GAP-16).
    index("tasks_defer_idx")
      .on(table.workspaceId, table.deferUntil)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.deferUntil} IS NOT NULL`,
      ),
    index("tasks_deadline_idx")
      .on(table.workspaceId, table.deadline)
      .where(
        sql`${table.deletedAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.deadline} IS NOT NULL`,
      ),
    // The completed history read, newest first (spec 9.6, migration 0014). Partial on the
    // completed rows, which is the only set that view touches, and carrying the sort order
    // so the first page is an index-only scan rather than a top-N sort over the table.
    index("tasks_completed_recent_idx")
      .on(table.workspaceId, table.updatedAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL AND ${table.completedAt} IS NOT NULL`),
    // Live, open tasks by due date, in the order Today and Upcoming read them (spec 9.2,
    // 9.3, migration 0014). `tasks_due_idx` covers the whole workspace including history,
    // so those views walked every row; this one is restricted to the tasks that can
    // appear in them. `rank` is COLLATE "C" on the column (migration 0001), so the index
    // orders by code point — `tasks.integration.test.ts` proves it.
    index("tasks_open_due_idx")
      .on(table.workspaceId, table.dueDate, table.rank, table.id)
      .where(sql`${table.deletedAt} IS NULL AND ${table.completedAt} IS NULL`),
    // Invariant 3: a due time cannot exist without a due date (spec 8.2).
    check(
      "tasks_due_time_requires_date",
      sql`${table.dueTime} IS NULL OR ${table.dueDate} IS NOT NULL`,
    ),
    // The deadline time follows the same rule (GAP-16).
    check(
      "tasks_deadline_time_requires_date",
      sql`${table.deadlineTime} IS NULL OR ${table.deadline} IS NOT NULL`,
    ),
    // A reminder is an offset from the due time, so it needs one (GAP-13).
    check(
      "tasks_reminder_requires_due_time",
      sql`${table.reminderOffsetMinutes} IS NULL OR ${table.dueTime} IS NOT NULL`,
    ),
    // Invariant 1: an Inbox task has no workflow status (spec 8.2).
    check(
      "tasks_inbox_has_no_status",
      sql`${table.projectId} IS NOT NULL OR ${table.statusId} IS NULL`,
    ),
    // Invariant 4: a task cannot be its own parent (spec 8.2).
    check(
      "tasks_no_self_parent",
      sql`${table.parentTaskId} IS NULL OR ${table.parentTaskId} <> ${table.id}`,
    ),
    check("tasks_version_positive", sql`${table.version} >= 1`),
    // A blocker flag carries its reason and its start together (spec 8.4).
    check(
      "tasks_blocked_reason_with_since",
      sql`(${table.blockedReason} IS NULL) = (${table.blockedSince} IS NULL)`,
    ),
  ],
);

/**
 * Task relationships (spec 8.4, 18.4). `blocks` is directed source → target; `related_to`
 * is symmetric and stored once in canonical id order (spec 8.2 invariant 8). Rows go
 * with a hard-deleted endpoint; a soft-deleted one merely hides them.
 */
export const taskRelations = pgTable(
  "task_relations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    targetTaskId: uuid("target_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: relationTypeEnum("type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdByActorKind: actorKindEnum("created_by_actor_kind").notNull(),
    createdByActorId: varchar("created_by_actor_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("task_relations_edge_key").on(
      table.sourceTaskId,
      table.targetTaskId,
      table.type,
    ),
    index("task_relations_source_idx").on(table.sourceTaskId),
    index("task_relations_target_idx").on(table.targetTaskId),
    // Invariant 4: a task cannot be its own relationship target (spec 8.2).
    check(
      "task_relations_no_self",
      sql`${table.sourceTaskId} <> ${table.targetTaskId}`,
    ),
  ],
);

/**
 * My Day is a dated relation rather than a field copied onto the task, so choosing a day
 * never rewrites the task and history is preserved (spec 8.1, ADR-001).
 */
export const taskDayPlans = pgTable(
  "task_day_plans",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    planDate: date("plan_date").notNull(),
    source: varchar("source", { length: 30 }).notNull().default("manual"),
    createdByActorKind: actorKindEnum("created_by_actor_kind").notNull(),
    createdByActorId: varchar("created_by_actor_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("task_day_plans_pk").on(table.taskId, table.planDate),
    index("task_day_plans_date_idx").on(table.planDate, table.taskId),
  ],
);
