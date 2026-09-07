import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "./workspace.js";

export const calendarFeedTokens = pgTable(
  "calendar_feed_tokens",
  {
    userId: text("user_id").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.workspaceId] }),
    uniqueIndex("calendar_feed_tokens_hash_idx").on(table.tokenHash),
  ],
);
