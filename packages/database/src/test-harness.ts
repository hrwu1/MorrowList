import { parseServerEnv } from "@morrowlist/config/env";

import { createDatabase, type DatabaseHandle } from "./client.js";
import { migrate } from "./migrate.js";

/**
 * PostgreSQL integration-test harness (FND-009, spec 28.1).
 *
 * Runs against a real database so migrations, constraints, row locking, and collation are
 * exercised for real. Between tests every table is truncated rather than dropped: it is
 * far faster than re-migrating, and it keeps the schema under test identical to the one
 * the migrations produced.
 */

let handle: DatabaseHandle | null = null;

export function testDatabaseUrl(): string {
  const env = parseServerEnv();
  const url = env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests must never run against the development database.",
    );
  }
  if (url === env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must differ from DATABASE_URL; the harness truncates every table.",
    );
  }
  return url;
}

/** Connect once per test process and apply pending migrations. */
export async function setupTestDatabase(): Promise<DatabaseHandle> {
  if (handle) return handle;
  handle = createDatabase({
    connectionString: testDatabaseUrl(),
    max: 5,
    applicationName: "morrowlist-tests",
  });
  await migrate({ pool: handle.pool });
  return handle;
}

export async function teardownTestDatabase(): Promise<void> {
  await handle?.close();
  handle = null;
}

/** Empty every application table, leaving the schema and migration log intact. */
export async function truncateAll(target: DatabaseHandle): Promise<void> {
  const { rows } = await target.pool.query<{ tablename: string }>(`
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like '\\_\\_%'
  `);
  if (rows.length === 0) return;

  const list = rows.map((row) => `"${row.tablename}"`).join(", ");
  await target.pool.query(`truncate table ${list} restart identity cascade`);
}
