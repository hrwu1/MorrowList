import { systemClock, uuidv7, type Clock } from "@morrowlist/domain";
import type { Logger } from "@morrowlist/observability";

import type { ClaimedDelivery, UnitOfWork } from "../ports/index.js";

import { matchesEventType } from "./mappers.js";
import { toEnvelope, type WebhookSender } from "./sender.js";

/**
 * The webhook dispatcher (GAP-18). One `tick(now)` does three things, in order:
 *
 * 1. **Fan out.** Unpublished outbox events get one pending delivery row per matching
 *    subscription. The insert is idempotent, so a tick that dies halfway is repaired by
 *    the next one rather than sending twice.
 * 2. **Attempt.** Due deliveries are claimed transactionally, POSTed outside the
 *    transaction, and their outcome recorded. A failure is rescheduled at 1 minute, then
 *    1 hour, then 6 hours; the fourth failure dead-letters the delivery.
 * 3. **Publish.** An outbox event whose deliveries have all reached a terminal state is
 *    marked published and stops being scanned.
 *
 * It is a plain exported function so the worker script and the embedded worker can both
 * call it on a tick, and so several processes can run it at once: every claim is
 * `FOR UPDATE SKIP LOCKED`.
 */

/** Retry schedule after a failed attempt (spec 26.1: bounded, then dead-letter). */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

/** One immediate attempt plus the three retries above. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

/** How many outbox rows one tick fans out, and how many attempts it makes. */
export const WEBHOOK_FANOUT_BATCH = 200;
export const WEBHOOK_ATTEMPT_BATCH = 50;

export interface WebhookDispatcherOptions {
  readonly unitOfWork: UnitOfWork;
  readonly sender: WebhookSender;
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export interface WebhookTickResult {
  /** Delivery rows created by the fan-out. */
  readonly queued: number;
  readonly delivered: number;
  readonly failed: number;
  /** Deliveries that ran out of attempts on this tick. */
  readonly deadLettered: number;
  readonly published: number;
}

export class WebhookDispatcher {
  private readonly unitOfWork: UnitOfWork;
  private readonly sender: WebhookSender;
  private readonly clock: Clock;
  private readonly logger: Logger | undefined;

  constructor(options: WebhookDispatcherOptions) {
    this.unitOfWork = options.unitOfWork;
    this.sender = options.sender;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger;
  }

  async tick(now: Date = this.clock.now()): Promise<WebhookTickResult> {
    const queued = await this.fanOut(now);
    const attempts = await this.attemptDue(now);
    const published = await this.publishSettled(now);
    const result = { queued, ...attempts, published };
    if (queued > 0 || attempts.delivered > 0 || attempts.failed > 0) {
      this.logger?.info("webhook dispatcher tick", { ...result });
    }
    return result;
  }

  /**
   * Create the pending deliveries for events nobody has been told about yet. An event
   * with no eligible subscription is published straight away, which is what keeps the
   * scan cheap on a workspace that uses no webhooks at all.
   */
  private async fanOut(now: Date): Promise<number> {
    return this.unitOfWork.execute(async (tx) => {
      const events = await tx.outbox.listPending(now, WEBHOOK_FANOUT_BATCH);
      if (events.length === 0) return 0;

      const subscriptionsByWorkspace = new Map<
        string,
        Awaited<ReturnType<typeof tx.webhookSubscriptions.listActive>>
      >();
      const nothingToSend: string[] = [];
      let queued = 0;

      for (const event of events) {
        let subscriptions = subscriptionsByWorkspace.get(event.workspaceId);
        if (!subscriptions) {
          subscriptions = await tx.webhookSubscriptions.listActive(event.workspaceId);
          subscriptionsByWorkspace.set(event.workspaceId, subscriptions);
        }

        const matching = subscriptions.filter(
          (subscription) =>
            // Eligibility is judged at the event's own instant, so an endpoint added
            // today never receives last week's backlog. It is checked per event rather
            // than in the query because one cached list serves every event here.
            subscription.createdAt.getTime() <= event.occurredAt.getTime() &&
            matchesEventType(subscription.eventTypes, event.eventType),
        );
        if (matching.length === 0) {
          nothingToSend.push(event.id);
          continue;
        }

        for (const subscription of matching) {
          const inserted = await tx.webhookDeliveries.enqueueIfAbsent({
            id: uuidv7(),
            workspaceId: event.workspaceId,
            subscriptionId: subscription.id,
            outboxEventId: event.id,
            eventType: event.eventType,
            status: "pending",
            attempt: 0,
            responseCode: null,
            error: null,
            nextAttemptAt: now,
            deliveredAt: null,
            createdAt: now,
            updatedAt: now,
          });
          if (inserted) queued += 1;
        }
      }

      if (nothingToSend.length > 0) {
        await tx.outbox.markPublished(nothingToSend, now);
      }
      return queued;
    });
  }

  /** Claim due attempts, send them, and record what happened. */
  private async attemptDue(
    now: Date,
  ): Promise<{ delivered: number; failed: number; deadLettered: number }> {
    const claimed = await this.unitOfWork.execute((tx) =>
      tx.webhookDeliveries.claimDue(now, WEBHOOK_ATTEMPT_BATCH),
    );

    let delivered = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const claim of claimed) {
      const outcome = await this.attempt(claim, now);
      if (outcome.status === "delivered") delivered += 1;
      else {
        failed += 1;
        if (outcome.status === "failed") deadLettered += 1;
      }
      await this.unitOfWork.execute((tx) =>
        tx.webhookDeliveries.recordOutcome(outcome),
      );
    }

    return { delivered, failed, deadLettered };
  }

  private async attempt(claim: ClaimedDelivery, now: Date) {
    const { delivery } = claim;
    // `claimDue` has already incremented the attempt counter, so this is the number of
    // the attempt being made right now.
    const attempt = delivery.attempt;

    if (!claim.event) {
      // The outbox row is gone (its workspace or task was deleted). Nothing to send and
      // nothing to retry; the delivery is closed so the log still shows what happened.
      return {
        id: delivery.id,
        status: "failed" as const,
        responseCode: null,
        error: "the event is no longer available",
        nextAttemptAt: null,
        deliveredAt: null,
        updatedAt: now,
      };
    }

    const envelope = toEnvelope(claim.event, delivery, attempt);
    const body = JSON.stringify(envelope);
    const response = await this.sender.send({
      url: claim.url,
      signingKey: claim.secretHash,
      body,
      deliveryId: delivery.id,
      eventId: claim.event.id,
      eventType: claim.event.eventType,
      attempt,
      timestampSeconds: Math.floor(now.getTime() / 1000),
    });

    if (response.status !== null && response.status >= 200 && response.status < 300) {
      return {
        id: delivery.id,
        status: "delivered" as const,
        responseCode: response.status,
        error: null,
        nextAttemptAt: null,
        deliveredAt: now,
        updatedAt: now,
      };
    }

    const retryIn = WEBHOOK_RETRY_DELAYS_MS[attempt - 1];
    const exhausted = attempt >= WEBHOOK_MAX_ATTEMPTS || retryIn === undefined;
    return {
      id: delivery.id,
      status: exhausted ? ("failed" as const) : ("pending" as const),
      responseCode: response.status,
      error: truncateError(response.error ?? "delivery failed"),
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryIn),
      deliveredAt: null,
      updatedAt: now,
    };
  }

  /** Publish the events whose deliveries have all finished, successfully or not. */
  private async publishSettled(now: Date): Promise<number> {
    return this.unitOfWork.execute(async (tx) => {
      const events = await tx.outbox.listPending(now, WEBHOOK_FANOUT_BATCH);
      if (events.length === 0) return 0;

      const ids = events.map((event) => event.id);
      const outstanding = new Set(await tx.webhookDeliveries.outstandingEventIds(ids));
      const settled = ids.filter((id) => !outstanding.has(id));
      if (settled.length === 0) return 0;

      await tx.outbox.markPublished(settled, now);
      return settled.length;
    });
  }
}

/** Keep an endpoint's error message short enough to store and safe enough to show. */
export function truncateError(message: string): string {
  const single = message.replace(/\s+/g, " ").trim();
  return single.length > 300 ? `${single.slice(0, 297)}...` : single;
}
