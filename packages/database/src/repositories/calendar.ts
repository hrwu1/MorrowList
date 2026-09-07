import type { CalendarFeedTokenRepository } from "@morrowlist/application";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { calendarFeedTokens as tokens } from "../schema/calendar.js";

export function createCalendarFeedTokenRepository(
  db: Database,
): CalendarFeedTokenRepository {
  return {
    async find(userId, workspaceId) {
      return (
        (
          await db
            .select()
            .from(tokens)
            .where(and(eq(tokens.userId, userId), eq(tokens.workspaceId, workspaceId)))
            .limit(1)
        )[0] ?? null
      );
    },
    async findByHash(hash) {
      return (
        (
          await db
            .select()
            .from(tokens)
            .where(and(eq(tokens.tokenHash, hash), isNull(tokens.revokedAt)))
            .limit(1)
        )[0] ?? null
      );
    },
    async replace(token) {
      await db
        .insert(tokens)
        .values(token)
        .onConflictDoUpdate({
          target: [tokens.userId, tokens.workspaceId],
          set: {
            tokenHash: token.tokenHash,
            createdAt: token.createdAt,
            revokedAt: null,
          },
        });
    },
    async revoke(userId, workspaceId, now) {
      const rows = await db
        .update(tokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(tokens.userId, userId),
            eq(tokens.workspaceId, workspaceId),
            isNull(tokens.revokedAt),
          ),
        )
        .returning({ userId: tokens.userId });
      return rows.length > 0;
    },
  };
}
