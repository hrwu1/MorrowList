import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { outboxEvents } from "./events.js";
import { workspaces } from "./workspace.js";

/**
 * Webhook delivery (GAP-18; the `webhook_subscriptions` and `webhook_deliveries` tables
 * of spec 18.4).
 *
 * The outbox is the source of truth for what happened; these two tables are the record of
 * who was told and how it went. A delivery row is created per (subscription, event) pair,
 * which is why the unique index matters: the dispatcher's fan-out is idempotent and may
 * run in several processes at once.
 */

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /**
     * SHA-256 of the secret the user was shown once, hex-encoded, and the key deliveries
     * are actually signed with. The plaintext secret is never stored, so a database read
     * cannot reveal the string the user may have saved elsewhere.
     */
    secretHash: text("secret_hash").notNull(),
    /** The visible head of the secret, so two subscriptions can be told apart. */
    secretPrefix: varchar("secret_prefix", { length: 20 }).notNull(),
    /** Event types or `task.*` / `*` prefixes. */
    eventTypes: text("event_types").array().notNull(),
    description: varchar("description", { length: 200 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // The dispatcher's fan-out lookup: the live endpoints of one workspace.
    index("webhook_subscriptions_active_idx")
      .on(table.workspaceId, table.createdAt)
      .where(sql`${table.active}`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    /** Null for a test delivery, which is sent once and never retried. */
    outboxEventId: uuid("outbox_event_id").references(() => outboxEvents.id, {
      onDelete: "cascade",
    }),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    /** `pending`, `delivered`, or `failed` (dead-lettered). */
    status: varchar("status", { length: 20 }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    responseCode: integer("response_code"),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Fan-out runs again on every tick until the outbox row is published; this is what
    // makes the second run a no-op instead of a duplicate delivery.
    uniqueIndex("webhook_deliveries_event_idx").on(
      table.subscriptionId,
      table.outboxEventId,
    ),
    // The dispatcher's claim: due attempts in firing order.
    index("webhook_deliveries_due_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    // The delivery log, newest first.
    index("webhook_deliveries_log_idx").on(
      table.subscriptionId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      "webhook_deliveries_status",
      sql`${table.status} IN ('pending', 'delivered', 'failed')`,
    ),
  ],
);
