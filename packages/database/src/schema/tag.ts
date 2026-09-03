import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { tasks } from "./task.js";
import { workspaces } from "./workspace.js";

/** Workspace-scoped tags and the task–tag association (spec 12.1, 18.2). */

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    // Lower-cased, whitespace-collapsed key for case-insensitive uniqueness and ordering.
    // COLLATE "C" is applied in migration 0003 so the order matches the in-memory
    // double's code-point comparison rather than the cluster locale.
    normalizedName: varchar("normalized_name", { length: 80 }).notNull(),
    colorToken: varchar("color_token", { length: 50 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("tags_workspace_normalized_name_key").on(
      table.workspaceId,
      table.normalizedName,
    ),
  ],
);

/**
 * Deleting a tag removes its associations but never a task (spec 12.1); deleting a task
 * (hard delete only, after Trash retention) removes its associations.
 */
export const taskTags = pgTable(
  "task_tags",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.tagId] }),
    // The reverse lookup: every task carrying a tag, for the tag filter and counts.
    index("task_tags_tag_idx").on(table.tagId, table.taskId),
  ],
);
