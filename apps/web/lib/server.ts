import "server-only";

import { createApiApp, createDavApp, type ApiDependencies } from "@morrowlist/api";
import {
  IdempotencyService,
  CalDavService,
  CalendarFeedService,
  InboundEmailService,
  ActivityService,
  FieldService,
  ExportService,
  FlowService,
  ImportService,
  ProjectService,
  SavedViewService,
  SearchService,
  TagService,
  TaskService,
  RuleService,
  ViewService,
  WebhookService,
  WorkflowService,
  WorkspaceService,
  bootstrapUser,
} from "@morrowlist/application";
import {
  createAuth,
  createAuthPort,
  createUserDirectory,
  type AuthPort,
} from "@morrowlist/auth";
import { parseServerEnv, type ServerEnv } from "@morrowlist/config/env";
import {
  checkDatabaseHealth,
  createDatabase,
  createUnitOfWork,
  type DatabaseHandle,
} from "@morrowlist/database";
import { createLogger, type Logger } from "@morrowlist/observability";
import {
  createWorkerServices,
  startBackgroundWorker,
  type BackgroundWorker,
} from "@morrowlist/transports";

/**
 * Composition root (spec 16.1). Every dependency is constructed exactly once here and
 * injected downwards, so no layer reaches for a global.
 *
 * Next.js may evaluate a module more than once per process in development; the container
 * is cached on globalThis so hot reloads do not open a new connection pool each time.
 */

export interface Container {
  readonly env: ServerEnv;
  readonly database: DatabaseHandle;
  readonly logger: Logger;
  readonly auth: AuthPort;
  readonly api: ReturnType<typeof createApiApp>;
  /** The CalDAV app, mounted at `/dav` by `middleware.ts` (GAP-25). */
  readonly dav: ReturnType<typeof createDavApp>;
  readonly handleAuthRequest: (request: Request) => Promise<Response>;
  /** The embedded reminder worker, when `WORKER_MODE=embedded` (GAP-13). */
  readonly worker: BackgroundWorker | null;
}

const CONTAINER_KEY = Symbol.for("morrowlist.container");

type GlobalWithContainer = typeof globalThis & { [CONTAINER_KEY]?: Container };

export function getContainer(): Container {
  const store = globalThis as GlobalWithContainer;
  const existing = store[CONTAINER_KEY];
  if (existing) return existing;

  const env = parseServerEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    base: { service: "morrowlist-web", env: env.NODE_ENV },
  });
  const database = createDatabase({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
  });
  const unitOfWork = createUnitOfWork(database);

  const authInstance = createAuth({
    db: database.db,
    env,
    // AUTH-003: a new account receives its personal workspace transactionally, and the
    // hook is idempotent so a retried callback creates no duplicates.
    onUserCreated: async (user) => {
      await bootstrapUser(
        { unitOfWork },
        {
          userId: user.id,
          email: user.email,
          displayName: user.name,
          // Onboarding confirms the timezone; UTC is the safe default until it does.
          timezone: "UTC",
        },
      );
    },
  });
  const auth = createAuthPort(authInstance);

  // Cursors are signed with the application secret so a client cannot forge a page
  // position (spec 20.6).
  const cursorSecret = env.AUTH_SECRET ?? "development-only-cursor-secret";
  const vapidKeys =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
          subject: env.VAPID_SUBJECT,
        }
      : null;
  const {
    notificationService,
    webhookSender,
    webhookDispatcher,
    ruleEngine,
    pushPublicKey,
  } = createWorkerServices({
    unitOfWork,
    userDirectory: createUserDirectory(database.db),
    logger,
    cursorSecret,
    appUrl: env.APP_URL,
    emailProvider: env.EMAIL_PROVIDER,
    vapidKeys,
  });
  const ruleService = new RuleService({ unitOfWork });
  const webhookService = new WebhookService({
    unitOfWork,
    sender: webhookSender,
    cursorSecret,
  });

  const taskService = new TaskService({ unitOfWork, cursorSecret });
  const dependencies: ApiDependencies = {
    idempotencyService: new IdempotencyService({
      unitOfWork,
      retentionMs: env.IDEMPOTENCY_RETENTION_HOURS * 60 * 60 * 1000,
    }),
    idempotencySecret: cursorSecret,
    calendarFeedService: new CalendarFeedService({
      unitOfWork,
      signingSecret: cursorSecret,
      appUrl: env.APP_URL,
    }),
    inboundEmailService: new InboundEmailService({
      unitOfWork,
      domain: env.INBOUND_EMAIL_DOMAIN,
      webhookSecret: env.INBOUND_EMAIL_SECRET,
      addressSecret: cursorSecret,
    }),
    auth,
    unitOfWork,
    pushPublicKey,
    workspaceService: new WorkspaceService({ unitOfWork }),
    projectService: new ProjectService({ unitOfWork }),
    workflowService: new WorkflowService({ unitOfWork }),
    taskService,
    calDavService: new CalDavService({ unitOfWork, taskService, appUrl: env.APP_URL }),
    activityService: new ActivityService({ unitOfWork, cursorSecret }),
    flowService: new FlowService({ unitOfWork }),
    exportService: new ExportService({ unitOfWork }),
    importService: new ImportService({ unitOfWork }),
    viewService: new ViewService({ unitOfWork }),
    tagService: new TagService({ unitOfWork }),
    fieldService: new FieldService({ unitOfWork }),
    searchService: new SearchService({ unitOfWork, cursorSecret }),
    savedViewService: new SavedViewService({ unitOfWork }),
    notificationService,
    webhookService,
    ruleService,
    logger,
    checkHealth: () => checkDatabaseHealth(database),
  };

  // One-container deploys run the background worker — reminders, digests, and webhook
  // delivery — inside the web process; `external` leaves it to `pnpm worker`.
  const worker =
    env.WORKER_MODE === "embedded"
      ? startBackgroundWorker({
          service: notificationService,
          logger: logger.child({ component: "notification-worker" }),
          pollIntervalMs: env.WORKER_POLL_SECONDS * 1000,
          webhookDispatcher,
          ruleEngine,
        })
      : null;

  const container: Container = {
    env,
    database,
    logger,
    auth,
    api: createApiApp(dependencies),
    dav: createDavApp(dependencies),
    handleAuthRequest: (request) => authInstance.handler(request),
    worker,
  };

  store[CONTAINER_KEY] = container;
  return container;
}
