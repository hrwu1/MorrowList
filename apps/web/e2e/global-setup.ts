import { createDatabase, migrate, truncateAll } from "@morrowlist/database";

import { e2eDatabaseUrl } from "./database";

/**
 * Prepare the browser suite's own database (spec 28.2).
 *
 * This file is the one place outside the composition root that may reach PostgreSQL
 * directly: it is harness code that provisions the database the suite drives, not
 * application code, and it runs before Next.js starts. Migrating here keeps the schema
 * under test identical to the one the migrations produce, and truncating first makes a
 * run independent of every run before it.
 */
export default async function globalSetup(): Promise<void> {
  const handle = createDatabase({
    connectionString: e2eDatabaseUrl(),
    max: 1,
    applicationName: "morrowlist-e2e",
  });
  try {
    await migrate({ pool: handle.pool });
    await truncateAll(handle);
  } finally {
    await handle.close();
  }
}
