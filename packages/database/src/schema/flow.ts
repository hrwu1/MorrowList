import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { statusCategoryEnum } from "./enums.js";
import { projects, workflowStatuses } from "./project.js";
import { tasks } from "./task.js";
import { workspaces } from "./workspace.js";

/**
 * Flow read model (GAP-17): one row per stay of a task in a workflow status, written in
 * the same transaction as the status change. Cycle time, throughput, work item age and
 * the cumulative flow diagram are all computed from these rows; nothing here is a source
 * of truth, so the table can be rebuilt from `activity_events` by the backfill.
 */
export const taskStatusIntervals = pgTable(
  "task_status_intervals",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    statusId: uuid("status_id")
      .notNull()
      .references(() => workflowStatuses.id, { onDelete: "cascade" }),
    // Copied from the status so a later category change does not rewrite history.
    category: statusCategoryEnum("category").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    // At most one open interval per task: the one it is in right now.
    uniqueIndex("task_status_intervals_open_key")
      .on(table.taskId)
      .where(sql`${table.leftAt} IS NULL`),
    index("task_status_intervals_task_idx").on(table.taskId, table.enteredAt),
    // The project read selects intervals still open or left inside the range.
    index("task_status_intervals_project_idx").on(table.projectId, table.leftAt),
    check(
      "task_status_intervals_ordered",
      sql`${table.leftAt} IS NULL OR ${table.leftAt} >= ${table.enteredAt}`,
    ),
  ],
);
