import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspace.js";

export const inboundAddresses = pgTable(
  "inbound_addresses",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("inbound_addresses_current_idx")
      .on(table.workspaceId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);
export const inboundReceipts = pgTable(
  "inbound_receipts",
  {
    addressId: uuid("address_id")
      .notNull()
      .references(() => inboundAddresses.id, { onDelete: "cascade" }),
    messageKey: text("message_key").notNull(),
    taskId: uuid("task_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.addressId, table.messageKey] })],
);
