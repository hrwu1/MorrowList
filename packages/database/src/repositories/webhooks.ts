import type {
  ClaimedDelivery,
  WebhookDelivery,
  WebhookDeliveryRepository,
  WebhookDeliveryStatus,
  WebhookSubscription,
  WebhookSubscriptionRepository,
} from "@morrowlist/application";
import type { ActorKind } from "@morrowlist/domain";
import { and, asc, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";

import type { Database } from "../client.js";
import { outboxEvents, webhookDeliveries, webhookSubscriptions } from "../schema/index.js";

/**
 * Webhook subscription and delivery persistence (GAP-18).
 *
 * The two claims here are what let several dispatchers run at once: `enqueueIfAbsent`
 * relies on the unique index to make fan-out idempotent, and `claimDue` takes its batch
 * with `FOR UPDATE SKIP LOCKED` so no attempt is made twice.
 */

type SubscriptionRow = typeof webhookSubscriptions.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

function toSubscription(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    secretHash: row.secretHash,
    secretPrefix: row.secretPrefix,
    eventTypes: row.eventTypes,
    description: row.description,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    subscriptionId: row.subscriptionId,
    outboxEventId: row.outboxEventId,
    eventType: row.eventType,
    status: row.status as WebhookDeliveryStatus,
    attempt: row.attempt,
    responseCode: row.responseCode,
    error: row.error,
    nextAttemptAt: row.nextAttemptAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createWebhookSubscriptionRepository(
  db: Database,
): WebhookSubscriptionRepository {
  return {
    async insert(subscription) {
      await db.insert(webhookSubscriptions).values({
        id: subscription.id,
        workspaceId: subscription.workspaceId,
        url: subscription.url,
        secretHash: subscription.secretHash,
        secretPrefix: subscription.secretPrefix,
        eventTypes: [...subscription.eventTypes],
        description: subscription.description,
        active: subscription.active,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      });
    },

    async update(subscription) {
      await db
        .update(webhookSubscriptions)
        .set({
          url: subscription.url,
          eventTypes: [...subscription.eventTypes],
          description: subscription.description,
          active: subscription.active,
          updatedAt: subscription.updatedAt,
        })
        .where(
          and(
            eq(webhookSubscriptions.id, subscription.id),
            eq(webhookSubscriptions.workspaceId, subscription.workspaceId),
          ),
        );
    },

    async findById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, id),
            eq(webhookSubscriptions.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      return row ? toSubscription(row) : null;
    },

    async list(workspaceId, cursor) {
      const conditions = [eq(webhookSubscriptions.workspaceId, workspaceId)];
      // Ids are UUIDv7, so ordering by id is ordering by creation and the keyset needs
      // nothing but the last id of the previous page.
      if (cursor.after) conditions.push(gt(webhookSubscriptions.id, cursor.after));

      const rows = await db
        .select()
        .from(webhookSubscriptions)
        .where(and(...conditions))
        .orderBy(asc(webhookSubscriptions.id))
        .limit(cursor.limit + 1);

      return {
        items: rows.slice(0, cursor.limit).map(toSubscription),
        hasMore: rows.length > cursor.limit,
        nextCursor: null,
      };
    },

    async delete(workspaceId, id) {
      const rows = await db
        .delete(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, id),
            eq(webhookSubscriptions.workspaceId, workspaceId),
          ),
        )
        .returning({ id: webhookSubscriptions.id });
      return rows.length > 0;
    },

    async listActive(workspaceId) {
      const rows = await db
        .select()
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.workspaceId, workspaceId),
            eq(webhookSubscriptions.active, true),
          ),
        )
        .orderBy(asc(webhookSubscriptions.id));
      return rows.map(toSubscription);
    },
  };
}

export function createWebhookDeliveryRepository(
  db: Database,
): WebhookDeliveryRepository {
  const values = (delivery: WebhookDelivery) => ({
    id: delivery.id,
    workspaceId: delivery.workspaceId,
    subscriptionId: delivery.subscriptionId,
    outboxEventId: delivery.outboxEventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempt: delivery.attempt,
    responseCode: delivery.responseCode,
    error: delivery.error,
    nextAttemptAt: delivery.nextAttemptAt,
    deliveredAt: delivery.deliveredAt,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  });

  return {
    async insert(delivery) {
      await db.insert(webhookDeliveries).values(values(delivery));
    },

    async enqueueIfAbsent(delivery) {
      // The unique index on (subscription_id, outbox_event_id) makes this the whole of
      // the fan-out's idempotency: a second dispatcher inserts nothing.
      const rows = await db
        .insert(webhookDeliveries)
        .values(values(delivery))
        .onConflictDoNothing({
          target: [webhookDeliveries.subscriptionId, webhookDeliveries.outboxEventId],
        })
        .returning({ id: webhookDeliveries.id });
      return rows.length > 0;
    },

    async claimDue(now, limit) {
      const due = db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.status, "pending"),
            isNotNull(webhookDeliveries.nextAttemptAt),
            lte(webhookDeliveries.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
        .limit(limit)
        .for("update", { skipLocked: true });

      // Taking the attempt and clearing the schedule in the same statement is what stops
      // a second dispatcher from picking the row up while this one is mid-POST.
      const claimed = await db
        .update(webhookDeliveries)
        .set({
          attempt: sql`${webhookDeliveries.attempt} + 1`,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(inArray(webhookDeliveries.id, due))
        .returning();
      if (claimed.length === 0) return [];

      const rows = await db
        .select({ delivery: webhookDeliveries, subscription: webhookSubscriptions, event: outboxEvents })
        .from(webhookDeliveries)
        .innerJoin(
          webhookSubscriptions,
          eq(webhookSubscriptions.id, webhookDeliveries.subscriptionId),
        )
        .leftJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.outboxEventId))
        .where(
          inArray(
            webhookDeliveries.id,
            claimed.map((row) => row.id),
          ),
        );

      return rows.map(
        (row): ClaimedDelivery => ({
          delivery: toDelivery(row.delivery),
          url: row.subscription.url,
          secretHash: row.subscription.secretHash,
          event: row.event
            ? {
                id: row.event.id,
                schemaVersion: row.event.schemaVersion,
                eventType: row.event.eventType,
                aggregateType: row.event.aggregateType,
                aggregateId: row.event.aggregateId,
                workspaceId: row.event.workspaceId,
                actor: row.event.actor as { kind: ActorKind; id: string },
                payload: row.event.payload as Record<string, unknown>,
                correlationId: row.event.correlationId,
                occurredAt: row.event.occurredAt,
              }
            : null,
        }),
      );
    },

    async recordOutcome(outcome) {
      await db
        .update(webhookDeliveries)
        .set({
          status: outcome.status,
          responseCode: outcome.responseCode,
          error: outcome.error,
          nextAttemptAt: outcome.nextAttemptAt,
          deliveredAt: outcome.deliveredAt,
          // Re-arming a dead-lettered delivery restarts the attempt budget; an ordinary
          // reschedule leaves the counter the claim already incremented.
          ...(outcome.resetAttempts ? { attempt: 0 } : {}),
          updatedAt: outcome.updatedAt,
        })
        .where(eq(webhookDeliveries.id, outcome.id));
    },

    async findById(workspaceId, id) {
      const [row] = await db
        .select()
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.id, id),
            eq(webhookDeliveries.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      return row ? toDelivery(row) : null;
    },

    async listForSubscription(workspaceId, subscriptionId, cursor) {
      const conditions = [
        eq(webhookDeliveries.workspaceId, workspaceId),
        eq(webhookDeliveries.subscriptionId, subscriptionId),
      ];
      // Newest first; UUIDv7 ids order the same way the timestamps do.
      if (cursor.after) {
        conditions.push(sql`${webhookDeliveries.id} < ${cursor.after}::uuid`);
      }

      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(and(...conditions))
        .orderBy(desc(webhookDeliveries.id))
        .limit(cursor.limit + 1);

      return {
        items: rows.slice(0, cursor.limit).map(toDelivery),
        hasMore: rows.length > cursor.limit,
        nextCursor: null,
      };
    },

    async outstandingEventIds(eventIds) {
      if (eventIds.length === 0) return [];
      const rows = await db
        .selectDistinct({ eventId: webhookDeliveries.outboxEventId })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.status, "pending"),
            inArray(webhookDeliveries.outboxEventId, [...eventIds]),
          ),
        );
      return rows
        .map((row) => row.eventId)
        .filter((id): id is string => id !== null);
    },
  };
}
