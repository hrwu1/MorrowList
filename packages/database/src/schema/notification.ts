import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { tasks } from "./task.js";
import { workspaces } from "./workspace.js";

/**
 * Reminders and notifications (GAP-13; the `notifications` table of spec 18.4).
 *
 * `task_reminders` is the derived schedule — one pending row per task, recomputed from the
 * canonical task by every command that can move its due instant — and the worker claims
 * due rows with `FOR UPDATE SKIP LOCKED` so two workers never deliver the same reminder.
 */

export const taskReminders = pgTable(
  "task_reminders",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    offsetMinutes: integer("offset_minutes").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // The worker's poll: only pending rows, in firing order.
    index("task_reminders_pending_idx")
      .on(table.remindAt)
      .where(sql`${table.deliveredAt} IS NULL`),
  ],
);

/** What a user is told and whether they have seen it. Read state is per user, never shared. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    kind: varchar("kind", { length: 30 }).notNull(),
    // A hard-deleted task leaves its notifications readable, just unlinked.
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("notifications_user_idx").on(
      table.userId,
      table.workspaceId,
      table.createdAt.desc(),
    ),
    // The bell's unread count.
    index("notifications_unread_idx")
      .on(table.userId, table.workspaceId)
      .where(sql`${table.readAt} IS NULL`),
  ],
);

/**
 * Per user per workspace: which channels carry reminders, when the daily digest goes
 * out (null = never), and the reminder offset new timed tasks receive. A missing row means
 * the defaults; `last_digest_date` is the once-a-day claim (spec 15, no floods).
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channels: jsonb("channels").notNull(),
    digestTime: time("digest_time"),
    timezone: varchar("timezone", { length: 100 }),
    defaultOffsetMinutes: integer("default_offset_minutes").notNull().default(30),
    lastDigestDate: date("last_digest_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId] })],
);

/** Web push registrations. The keys are credentials and never appear in an event payload. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    userId: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    keys: jsonb("keys").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.endpoint] })],
);
