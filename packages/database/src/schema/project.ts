import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { statusCategoryEnum } from "./enums.js";
import { workspaces } from "./workspace.js";

/** Projects and their workflow statuses (spec 18.2). */

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    descriptionMd: text("description_md"),
    colorToken: varchar("color_token", { length: 50 }).notNull(),
    icon: varchar("icon", { length: 80 }),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByActorKind: varchar("created_by_actor_kind", { length: 30 }).notNull(),
    createdByActorId: varchar("created_by_actor_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("projects_workspace_slug_key").on(table.workspaceId, table.slug),
    // Case-insensitive name uniqueness within a workspace (spec 18.2).
    uniqueIndex("projects_workspace_name_key").on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
    index("projects_workspace_archived_idx").on(table.workspaceId, table.archivedAt),
  ],
);

export const workflowStatuses = pgTable(
  "workflow_statuses",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    category: statusCategoryEnum("category").notNull(),
    // COLLATE "C" so ordering follows the rank alphabet's code points rather than the
    // database locale, which would sort 'a' before 'B' (see domain/shared/rank.ts).
    rank: varchar("rank", { length: 64 }).notNull(),
    // The COLLATE "C" clause itself lives in migration 0001; Drizzle does not model
    // column collation, so the migration is the source of truth for it.
    colorToken: varchar("color_token", { length: 50 }).notNull(),
    wipLimit: integer("wip_limit"),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("workflow_statuses_project_rank_idx").on(
      table.projectId,
      table.archivedAt,
      table.rank,
    ),
    // Exactly one active default status per project (spec 11.4). The partial index
    // covers only active default rows, so archived history does not block a new default.
    uniqueIndex("workflow_statuses_one_default_idx")
      .on(table.projectId)
      .where(sql`${table.isDefault} AND ${table.archivedAt} IS NULL`),
  ],
);
