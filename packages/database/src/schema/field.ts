import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
 * Workspace-scoped typed custom fields (GAP-24, spec 18.4).
 *
 * The definitions live here; the values live in `tasks.fields`, keyed by `key`, so a task
 * stays one row and one model (ADR-001). At most ten definitions per workspace — the cap
 * is enforced in `FieldService` because it needs to count inside the transaction, and the
 * partial-unique index below keeps `key` unique whatever writes it.
 */
export const fieldDefinitions = pgTable(
  "field_definitions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Lower-case identifier: the key of the value map, a filter term, a CLI flag. */
    key: varchar("key", { length: 40 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    /** One of select | number | date | text; a check constraint pins the four. */
    type: varchar("type", { length: 10 }).notNull(),
    /** The allowed values of a select as a JSON array; `[]` for every other type. */
    options: jsonb("options").notNull().default([]),
    // COLLATE "C" is applied in migration 0013, as for every other rank column (0001).
    rank: varchar("rank", { length: 64 }).notNull(),
    showOnCard: boolean("show_on_card").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("field_definitions_workspace_key").on(table.workspaceId, table.key),
    index("field_definitions_rank_idx").on(table.workspaceId, table.rank),
    check(
      "field_definitions_type_check",
      sql`${table.type} IN ('select', 'number', 'date', 'text')`,
    ),
  ],
);
