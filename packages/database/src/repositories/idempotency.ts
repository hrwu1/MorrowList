import type { IdempotencyRepository } from "@morrowlist/application";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { idempotencyRecords } from "../schema/idempotency.js";

export function createIdempotencyRepository(db: Database): IdempotencyRepository {
  return {
    async lock(scopeHash, keyHash) {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`replay:${scopeHash}:${keyHash}`}, 0))`,
      );
    },
    async find(scopeHash, keyHash) {
      const [record] = await db
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.scopeHash, scopeHash),
            eq(idempotencyRecords.keyHash, keyHash),
          ),
        )
        .limit(1);
      return record ?? null;
    },
    async save(record) {
      await db
        .insert(idempotencyRecords)
        .values(record)
        .onConflictDoUpdate({
          target: [idempotencyRecords.scopeHash, idempotencyRecords.keyHash],
          set: record,
        });
    },
    async pruneExpired(now) {
      await db.execute(sql`
        delete from ${idempotencyRecords} where (scope_hash, key_hash) in (
          select scope_hash, key_hash from ${idempotencyRecords}
          where expires_at <= ${now.toISOString()}::timestamptz
          order by expires_at limit 100 for update skip locked
        )
      `);
    },
  };
}
