import type { Cursor, Page } from "./tasks.js";

/**
 * Webhook persistence (GAP-18). Implemented by `@morrowlist/database`; the in-memory
 * doubles in `testing/` mirror the same contracts.
 */

export interface WebhookSubscription {
  readonly id: string;
  readonly workspaceId: string;
  readonly url: string;
  /**
   * The signing key: SHA-256 of the secret shown to the user once, hex-encoded. The
   * plaintext is never stored, so this value must never be logged or returned either.
   */
  readonly secretHash: string;
  readonly secretPrefix: string;
  /** Exact event types, `task.*` prefixes, or `*`. */
  readonly eventTypes: readonly string[];
  readonly description: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookDelivery {
  readonly id: string;
  readonly workspaceId: string;
  readonly subscriptionId: string;
  /** Null for a test delivery, which has no outbox row and is never retried. */
  readonly outboxEventId: string | null;
  readonly eventType: string;
  readonly status: WebhookDeliveryStatus;
  readonly attempt: number;
  readonly responseCode: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WebhookSubscriptionRepository {
  insert(subscription: WebhookSubscription): Promise<void>;
  update(subscription: WebhookSubscription): Promise<void>;
  findById(workspaceId: string, id: string): Promise<WebhookSubscription | null>;
  list(workspaceId: string, cursor: Cursor): Promise<Page<WebhookSubscription>>;
  /** Returns false when nothing was deleted, so the route can answer 404 honestly. */
  delete(workspaceId: string, id: string): Promise<boolean>;
  /** Every live endpoint of one workspace, for the dispatcher's fan-out. */
  listActive(workspaceId: string): Promise<readonly WebhookSubscription[]>;
}

/** One attempt's worth of work: what to send, where, and signed with which key. */
export interface ClaimedDelivery {
  readonly delivery: WebhookDelivery;
  readonly url: string;
  readonly secretHash: string;
  /** The stored event this delivery carries; null once the outbox row has been purged. */
  readonly event: {
    readonly id: string;
    readonly schemaVersion: number;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly workspaceId: string;
    readonly actor: { readonly kind: string; readonly id: string };
    readonly payload: Record<string, unknown>;
    readonly correlationId: string;
    readonly occurredAt: Date;
  } | null;
}

export interface WebhookDeliveryOutcome {
  readonly id: string;
  readonly status: WebhookDeliveryStatus;
  readonly responseCode: number | null;
  readonly error: string | null;
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly updatedAt: Date;
  /**
   * Start the attempt budget again. Only a manual retry sets it: an ordinary reschedule
   * must keep the counter the claim incremented, or the backoff never grows.
   */
  readonly resetAttempts?: boolean;
}

export interface WebhookDeliveryRepository {
  insert(delivery: WebhookDelivery): Promise<void>;
  /**
   * Fan-out: create the pending row for this (subscription, event) pair, or do nothing if
   * it already exists. Idempotent so a re-run of the same tick cannot double-deliver.
   */
  enqueueIfAbsent(delivery: WebhookDelivery): Promise<boolean>;
  /**
   * Atomically take up to `limit` due attempts, incrementing `attempt` and clearing
   * `next_attempt_at` so no other dispatcher can take the same row (`FOR UPDATE SKIP
   * LOCKED` in SQL). The caller must record an outcome for every row it receives.
   */
  claimDue(now: Date, limit: number): Promise<readonly ClaimedDelivery[]>;
  recordOutcome(outcome: WebhookDeliveryOutcome): Promise<void>;
  findById(workspaceId: string, id: string): Promise<WebhookDelivery | null>;
  listForSubscription(
    workspaceId: string,
    subscriptionId: string,
    cursor: Cursor,
  ): Promise<Page<WebhookDelivery>>;
  /** Outbox ids among `eventIds` that still have a delivery waiting to be attempted. */
  outstandingEventIds(eventIds: readonly string[]): Promise<readonly string[]>;
}
