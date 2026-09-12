import {
  NotificationService,
  RuleEngine,
  WebhookDispatcher,
  type UnitOfWork,
  type UserDirectory,
} from "@morrowlist/application";
import type { Clock } from "@morrowlist/domain";
import type { Logger } from "@morrowlist/observability";

import { createConsoleEmailSender, createConsolePushSender } from "./console.js";
import type { HttpTransportOptions } from "./http.js";
import { createWebPushSender, type VapidKeys } from "./web-push.js";
import { createFetchWebhookSender } from "./webhooks.js";

export interface WorkerServicesOptions extends HttpTransportOptions {
  readonly unitOfWork: UnitOfWork;
  readonly userDirectory: UserDirectory;
  readonly logger: Logger;
  readonly cursorSecret: string;
  readonly appUrl: string;
  readonly emailProvider?: "console" | "smtp";
  readonly vapidKeys?: VapidKeys | null;
  readonly clock?: Clock;
}

/** Identical service and adapter wiring for embedded and standalone worker processes. */
export function createWorkerServices(options: WorkerServicesOptions) {
  const { unitOfWork, logger, vapidKeys, clock } = options;
  if (options.emailProvider === "smtp") {
    logger.warn("EMAIL_PROVIDER=smtp has no transport yet; using the console sender");
  }
  if (!vapidKeys) logger.info("web push is not configured; set VAPID_* to enable it");
  const timing = clock ? { clock } : {};
  const http = {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
  const notificationService = new NotificationService({
    unitOfWork,
    ...timing,
    cursorSecret: options.cursorSecret,
    emailSender: createConsoleEmailSender(logger),
    pushSender: vapidKeys
      ? createWebPushSender({ keys: vapidKeys, ...timing, ...http })
      : createConsolePushSender(logger),
    userDirectory: options.userDirectory,
    appUrl: options.appUrl,
    logger,
  });
  const webhookSender = createFetchWebhookSender(http);
  const webhookDispatcher = new WebhookDispatcher({
    unitOfWork,
    sender: webhookSender,
    logger: logger.child({ component: "webhook-dispatcher" }),
    ...timing,
  });
  const ruleEngine = new RuleEngine({ unitOfWork, ...timing });
  return {
    notificationService,
    webhookSender,
    webhookDispatcher,
    ruleEngine,
    pushPublicKey: vapidKeys?.publicKey ?? null,
  };
}
