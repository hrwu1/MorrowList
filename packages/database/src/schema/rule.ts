import type { Rule } from "@morrowlist/application";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { outboxEvents } from "./events.js";
import { workspaces } from "./workspace.js";
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    trigger: jsonb("trigger").$type<Rule["trigger"]>().notNull(),
    conditions: jsonb("conditions").$type<Rule["conditions"]>().notNull(),
    actions: jsonb("actions").$type<Rule["actions"]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rules_workspace_idx").on(t.workspaceId, t.id)],
);
export const ruleRuns = pgTable(
  "rule_runs",
  {
    id: uuid("id").primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    eventKey: text("event_key").notNull(),
    outboxEventId: uuid("outbox_event_id").references(() => outboxEvents.id, {
      onDelete: "set null",
    }),
    status: varchar("status", { length: 20 })
      .$type<"succeeded" | "skipped" | "failed">()
      .notNull(),
    error: text("error"),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("rule_runs_event_idx").on(t.ruleId, t.eventKey),
    index("rule_runs_log_idx").on(t.ruleId, t.ranAt.desc(), t.id.desc()),
    check("rule_runs_status", sql`${t.status} in ('succeeded', 'skipped', 'failed')`),
  ],
);
