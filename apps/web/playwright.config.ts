import { loadRootEnv } from "@morrowlist/config/load-env";
import { defineConfig, devices } from "@playwright/test";

import { e2eDatabaseUrl } from "./e2e/database";

// Playwright reads no env file of its own; the suite's database comes from the root `.env`.
loadRootEnv();

// Requests the service worker makes are routed like the page's own, so the offline
// suite can cut the worker off from the network deterministically (spec 25, 28.1).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

/**
 * Browser end-to-end baseline (FND-009, spec 28.2).
 *
 * The suite runs against a real server and a real PostgreSQL database, because the
 * behaviour worth covering here — the session survives a reload, a captured task appears
 * in the Inbox — depends on both. That database is its own, not the development one:
 * every test signs up, so sharing would silently fill day-to-day data with junk.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${PORT}`;
const databaseUrl = e2eDatabaseUrl();

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Firefox and WebKit are in the MVP browser matrix (spec 28.2); enable them in CI
    // once the browsers are provisioned there.
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `${baseURL}/api/v1/health`,
    // Never reuse a server already listening on this port: it may have been started
    // against DATABASE_URL, which would put the suite's rows back in development data.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      // The suite signs up and out repeatedly from its own origin, so that origin must be
      // the one auth trusts, whatever the developer's `.env` says (CI sets the same).
      APP_URL: baseURL,
      AUTH_TRUSTED_ORIGINS: [process.env.AUTH_TRUSTED_ORIGINS, baseURL]
        .filter(Boolean)
        .join(","),
      // The reminder worker polls fast here so a reminder due in a minute is seen in time.
      WORKER_POLL_SECONDS: "2",
    },
  },
});
