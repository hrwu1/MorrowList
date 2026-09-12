#!/usr/bin/env node
/**
 * The background worker as its own process (GAP-13, GAP-18): `pnpm worker`, for
 * deployments that set `WORKER_MODE=external` on the web app. Same loop as the embedded
 * one — reminders, digests, and webhook delivery on every tick — and several copies may
 * run because every claim is transactional. Requires `pnpm build` first.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
// Workspace packages are dependencies of the web app, not of the repository root, so they
// are resolved from there.
const require = createRequire(resolve(root, "apps/web/package.json"));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);

const [{ loadRootEnv }, { parseServerEnv }] = await Promise.all([
  load("@morrowlist/config/load-env"),
  load("@morrowlist/config/env"),
]);
loadRootEnv();
const env = parseServerEnv();

const [transports, auth, database, observability] = await Promise.all([
  load("@morrowlist/transports"),
  load("@morrowlist/auth"),
  load("@morrowlist/database"),
  load("@morrowlist/observability"),
]);

const logger = observability.createLogger({
  level: env.LOG_LEVEL,
  base: { service: "morrowlist-worker", env: env.NODE_ENV },
});
const handle = database.createDatabase({
  connectionString: env.DATABASE_URL,
  max: 2,
  applicationName: "morrowlist-worker",
});
const unitOfWork = database.createUnitOfWork(handle);
// Same rule as the web process: a configured VAPID pair sends, otherwise the console
// adapter logs what would have been sent (GAP-13 step 7).
const vapidKeys =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      }
    : null;
const { notificationService, webhookDispatcher, ruleEngine } =
  transports.createWorkerServices({
    unitOfWork,
    cursorSecret: env.AUTH_SECRET ?? "development-only-cursor-secret",
    userDirectory: auth.createUserDirectory(handle.db),
    appUrl: env.APP_URL,
    emailProvider: env.EMAIL_PROVIDER,
    vapidKeys,
    logger,
  });
const worker = transports.startBackgroundWorker({
  service: notificationService,
  logger,
  pollIntervalMs: env.WORKER_POLL_SECONDS * 1000,
  webhookDispatcher,
  ruleEngine,
});

// Keep the process alive between ticks; the worker's own timer is unref'd on purpose.
const keepAlive = setInterval(() => {}, 60_000);

async function shutdown(signal) {
  logger.info("shutting down", { signal });
  clearInterval(keepAlive);
  await worker.stop();
  await handle.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
