import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { actorKindEnum, aggregateTypeEnum } from "./enums.js";
import { workspaces } from "./workspace.js";

/**
 * Activity is the user-facing history; the outbox is the machine-facing event stream
 * (spec 18.2, 26.2). Both are written in the same transaction as the data change.
 */

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    aggregateType: aggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    actorKind: actorKindEnum("actor_kind").notNull(),
    actorId: varchar("actor_id", { length: 200 }).notNull(),
    actorDisplayName: varchar("actor_display_name", { length: 200 }),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull().default({}),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("activity_events_aggregate_idx").on(
      table.workspaceId,
      table.aggregateType,
      table.aggregateId,
      table.createdAt.desc(),
    ),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    aggregateType: aggregateTypeEnum("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    actor: jsonb("actor").notNull(),
    payload: jsonb("payload").notNull(),
    correlationId: varchar("correlation_id", { length: 200 }).notNull(),
    causationId: varchar("causation_id", { length: 200 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    // Supports a future dispatcher claiming the next batch of unpublished events.
    index("outbox_events_pending_idx")
      .on(table.availableAt, table.id)
      .where(sql`${table.publishedAt} IS NULL`),
  ],
);
