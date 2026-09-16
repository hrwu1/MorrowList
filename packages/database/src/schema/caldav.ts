import {
  jsonb,
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

/**
 * CalDAV resources a client has written (GAP-25). A task without a row is served under
 * its id with generated properties; a row records the client-chosen resource name, the
 * client UID, and the iCalendar properties MorrowList does not model, so they round-trip.
 */
export const caldavObjects = pgTable(
  "caldav_objects",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    resource: varchar("resource", { length: 20 }).notNull(),
    path: text("path").notNull(),
    uid: text("uid").notNull(),
    properties: jsonb("properties").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.taskId, table.resource] }),
    uniqueIndex("caldav_objects_path_idx").on(table.workspaceId, table.path),
    uniqueIndex("caldav_objects_uid_idx").on(table.workspaceId, table.uid),
  ],
);
