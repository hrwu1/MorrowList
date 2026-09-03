import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { workspaceRoleEnum } from "./enums.js";

/** Workspaces, memberships, and the per-workspace task number counter (spec 18.2). */

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    taskKeyPrefix: varchar("task_key_prefix", { length: 10 }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    // Cross-project WIP limit (GAP-20); added by migration 0005. Null means no limit.
    inProgressLimit: integer("in_progress_limit"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("workspaces_slug_key").on(table.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: workspaceRoleEnum("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("workspace_members_user_idx").on(table.userId),
  ],
);

/**
 * Task numbers are allocated from this row inside the task-creation transaction, using
 * `SELECT ... FOR UPDATE`, so two concurrent creates never share a number (spec 18.2).
 */
export const workspaceTaskCounters = pgTable("workspace_task_counters", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
});
