import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspace.js";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    scopeHash: varchar("scope_hash", { length: 64 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    response: text("response_ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeHash, table.keyHash] }),
    index("idempotency_records_expiry_idx").on(table.expiresAt),
  ],
);
