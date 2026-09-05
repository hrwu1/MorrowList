import type { Logger } from "@morrowlist/observability";

import type { WebhookDispatcher } from "../webhooks/dispatcher.js";

import type { NotificationService } from "./service.js";

/**
 * The background worker (GAP-13, extended by GAP-18): a polling loop, not a queue. Every
 * tick delivers the reminders that have come due, any digests whose time has passed, and
 * — when a dispatcher is supplied — the webhook deliveries that are due. It is a plain
 * function so the web process can embed it and `scripts/worker.mjs` can run it alone;
 * several instances may run at once because every claim is transactional.
 *
 * There is deliberately one loop rather than one per job: the work is all short, database
 * claims already prevent overlap, and a second timer would double the idle polling cost.
 */

export interface NotificationWorkerOptions {
  readonly service: NotificationService;
  readonly logger: Logger;
  readonly pollIntervalMs: number;
  readonly now?: () => Date;
  /** Webhook delivery (GAP-18). Omitted, the tick does reminders and digests only. */
  readonly webhookDispatcher?: WebhookDispatcher | undefined;
}

export interface WorkerTickResult {
  readonly reminders: number;
  readonly digests: number;
  /** Delivery attempts that succeeded on this tick. */
  readonly webhooks: number;
}

export interface NotificationWorker {
  /** Run one tick now, independently of the timer. Concurrent ticks are serialised. */
  tick(): Promise<WorkerTickResult>;
  /** Stop the timer and wait for an in-flight tick to finish. */
  stop(): Promise<void>;
}

export function startNotificationWorker(
  options: NotificationWorkerOptions,
): NotificationWorker {
  const { service, logger } = options;
  const now = options.now ?? (() => new Date());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<WorkerTickResult> | null = null;

  async function runTick(): Promise<WorkerTickResult> {
    const at = now();
    const result = { reminders: 0, digests: 0, webhooks: 0 };
    try {
      result.reminders = await service.deliverDue(at);
      result.digests = await service.digest(at);
      if (result.reminders > 0 || result.digests > 0) {
        logger.info("notifications delivered", {
          reminders: result.reminders,
          digests: result.digests,
        });
      }
      // Webhook delivery is separate work on the same tick: a failing endpoint must not
      // hold up a reminder, and a failing reminder must not stop a delivery.
      if (options.webhookDispatcher) {
        result.webhooks = (await options.webhookDispatcher.tick(at)).delivered;
      }
    } catch (error) {
      // One bad tick must not stop the loop; the next tick claims what is still pending.
      logger.error("notification worker tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return result;
  }

  function tick() {
    // Serialise: a manual tick during a timer tick waits for it rather than overlapping.
    const run = (inFlight ?? Promise.resolve()).then(runTick);
    inFlight = run;
    return run;
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void tick().finally(schedule);
    }, options.pollIntervalMs);
    // Never keep a process alive for the timer alone; the server or script does that.
    timer.unref?.();
  }

  logger.info("notification worker started", {
    pollIntervalMs: options.pollIntervalMs,
  });
  void tick().finally(schedule);

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await inFlight;
      logger.info("notification worker stopped");
    },
  };
}
