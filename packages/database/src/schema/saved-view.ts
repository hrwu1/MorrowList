import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspace.js";

/**
 * Personal saved views (spec 9.8, 18.4, GAP-02): a named filter set that renders as a
 * list or a board. A view belongs to one user and is never shared; `filters` is the
 * list-query shape the task list endpoint takes back.
 *
 * The case-insensitive name uniqueness (`lower(name)`) and the `COLLATE "C"` on `rank`
 * are expressed in migration 0004, which is the source of truth for both.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    filters: jsonb("filters").notNull(),
    layout: varchar("layout", { length: 10 }).notNull(),
    rank: varchar("rank", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("saved_views_owner_name_key").on(
      table.workspaceId,
      table.ownerUserId,
      table.name,
    ),
    index("saved_views_owner_rank_idx").on(
      table.workspaceId,
      table.ownerUserId,
      table.rank,
    ),
  ],
);
