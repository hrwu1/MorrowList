import { parseServerEnv } from "@morrowlist/config/env";

/**
 * The database the browser suite drives.
 *
 * Playwright exercises real sign-up, so every run creates users, workspaces, and tasks.
 * Those must not accumulate in the development database, and the global setup truncates
 * whatever it is pointed at — so the guard here mirrors the integration harness: refuse
 * to run unless a distinct database has been configured.
 */
export function e2eDatabaseUrl(): string {
  const env = parseServerEnv();
  const url = env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL is not set. The browser suite must never run against the development database.",
    );
  }
  if (url === env.DATABASE_URL) {
    throw new Error(
      "E2E_DATABASE_URL must differ from DATABASE_URL; the suite truncates every table.",
    );
  }
  return url;
}
