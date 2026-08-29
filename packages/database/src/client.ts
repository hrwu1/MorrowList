import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema/index.js";

/**
 * Connection lifecycle (FND-005). One pool per process; the pool is created lazily and
 * closed explicitly, so tests and short-lived CLI processes do not leak connections.
 */

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "morrowlist",
    // Fail fast rather than hanging a request behind an exhausted pool.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
  const pool = new Pool(config);
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

/** Readiness probe backing `GET /api/v1/ready` (spec FND-004, FND-006). */
export async function checkDatabaseHealth(
  handle: DatabaseHandle,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  try {
    await handle.pool.query("SELECT 1");
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}
