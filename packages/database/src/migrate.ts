import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

/**
 * Migration runner (FND-005). Applies reviewed SQL files in filename order inside a
 * transaction each, recording what has run so re-running is safe. Drizzle Kit generates
 * the files; nothing is pushed to a database straight from the schema definition.
 */

const MIGRATIONS_TABLE = "__morrowlist_migrations";

export interface MigrateOptions {
  readonly pool: Pool;
  readonly directory?: string;
  readonly log?: (message: string) => void;
}

export interface MigrateResult {
  readonly applied: string[];
  readonly skipped: string[];
}

function defaultDirectory(): string {
  // dist/migrate.js -> package root -> drizzle/
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const directory = options.directory ?? defaultDirectory();
  const log = options.log ?? (() => {});

  await options.pool.query(`
    create table if not exists ${MIGRATIONS_TABLE} (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith(".sql")).sort();

  const { rows } = await options.pool.query<{ name: string }>(
    `select name from ${MIGRATIONS_TABLE}`,
  );
  const already = new Set(rows.map((row) => row.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (already.has(file)) {
      skipped.push(file);
      continue;
    }

    const sql = await readFile(join(directory, file), "utf8");
    const client = await options.pool.connect();
    try {
      await client.query("begin");
      // Drizzle separates statements with this marker; running them individually keeps
      // error messages pointed at the failing statement.
      for (const statement of sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) await client.query(trimmed);
      }
      await client.query(`insert into ${MIGRATIONS_TABLE} (name) values ($1)`, [file]);
      await client.query("commit");
      applied.push(file);
      log(`applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw new Error(
        `migration ${file} failed: ${error instanceof Error ? error.message : error}`,
        { cause: error },
      );
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}
