import { parseServerEnv } from "@morrowlist/config/env";

import { createDatabase } from "./client.js";
import { migrate } from "./migrate.js";

/** `pnpm db:migrate` — applies pending migrations to DATABASE_URL. */
const env = parseServerEnv();
const target = process.argv.includes("--test")
  ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL)
  : env.DATABASE_URL;

const handle = createDatabase({ connectionString: target, max: 1 });
try {
  const result = await migrate({
    pool: handle.pool,
    log: (message) => console.log(message),
  });
  console.log(
    `migrations complete: ${result.applied.length} applied, ${result.skipped.length} already present`,
  );
} finally {
  await handle.close();
}
