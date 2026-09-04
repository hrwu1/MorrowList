import type { Logger } from "@morrowlist/observability";

import type { NotificationService } from "./service.js";

/**
 * The reminder worker (GAP-13): a polling loop, not a queue. Every tick delivers the
 * reminders that have come due and any digests whose time has passed. It is a plain
 * function so the web process can embed it and `scripts/worker.mjs` can run it alone;
 * several instances may run at once because every claim is transactional.
 */

export interface NotificationWorkerOptions {
  readonly service: NotificationService;
  readonly logger: Logger;
  readonly pollIntervalMs: number;
  readonly now?: () => Date;
}

export interface NotificationWorker {
  /** Run one tick now, independently of the timer. Concurrent ticks are serialised. */
  tick(): Promise<{ reminders: number; digests: number }>;
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
  let inFlight: Promise<{ reminders: number; digests: number }> | null = null;

  async function runTick() {
    const at = now();
    const result = { reminders: 0, digests: 0 };
    try {
      result.reminders = await service.deliverDue(at);
      result.digests = await service.digest(at);
      if (result.reminders > 0 || result.digests > 0) {
        logger.info("notifications delivered", result);
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
