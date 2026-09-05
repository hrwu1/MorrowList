import type {
  CreateWebhookRequest,
  CreatedWebhookSubscriptionDto,
  ListWebhookDeliveriesQuery,
  UpdateWebhookRequest,
  WebhookDeliveryDto,
  WebhookDeliveryListResponse,
  WebhookSubscriptionDto,
  WebhookSubscriptionListResponse,
} from "@morrowlist/contracts";
import { WORKSPACE_EVENTS } from "@morrowlist/contracts";
import { DomainError, systemClock, uuidv7, type Clock } from "@morrowlist/domain";

import type {
  TransactionContext,
  UnitOfWork,
  WebhookDelivery,
  WebhookSubscription,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { decodeCursor, encodeCursor } from "../shared/cursor.js";
import { recordEvent } from "../shared/event-recorder.js";

import { toWebhookDeliveryDto, toWebhookSubscriptionDto } from "./mappers.js";
import { toEnvelope, type WebhookSender } from "./sender.js";
import { deriveSigningKey, generateWebhookSecret, secretPrefix } from "./signature.js";

/**
 * Webhook subscriptions (GAP-18, spec 18.4).
 *
 * Managing an endpoint is workspace configuration, so it needs `workspace:write` and it
 * records an activity row and an outbox event like every other material mutation. The
 * secret is generated here, returned exactly once, and stored only as the signing key it
 * derives; nothing in this class logs it or puts it in a payload.
 *
 * Delivery itself belongs to `WebhookDispatcher`. The one exception is `test`, which
 * sends immediately and does not retry, because a test that answers ten minutes later
 * tells the person configuring the endpoint nothing.
 */

export interface WebhookServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly sender: WebhookSender;
  readonly clock?: Clock;
  readonly cursorSecret: string;
}

/** The event type a test delivery carries. Subscribers may ignore it. */
export const WEBHOOK_TEST_EVENT = "webhook.test";

export class WebhookService {
  private readonly unitOfWork: UnitOfWork;
  private readonly sender: WebhookSender;
  private readonly clock: Clock;
  private readonly cursorSecret: string;

  constructor(options: WebhookServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.sender = options.sender;
    this.clock = options.clock ?? systemClock;
    this.cursorSecret = options.cursorSecret;
  }

  async list(
    context: ActorContext,
    workspaceId: string,
    query: { limit: number; cursor?: string | undefined },
  ): Promise<WebhookSubscriptionListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    return this.unitOfWork.execute(async (tx) => {
      const page = await tx.webhookSubscriptions.list(
        workspaceId,
        this.toCursor(query),
      );
      return {
        data: page.items.map(toWebhookSubscriptionDto),
        page: { hasMore: page.hasMore, nextCursor: this.nextCursor(page) },
      };
    });
  }

  async create(
    context: ActorContext,
    workspaceId: string,
    request: CreateWebhookRequest,
  ): Promise<CreatedWebhookSubscriptionDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    const secret = generateWebhookSecret();
    const now = this.clock.now();
    const subscription: WebhookSubscription = {
      id: uuidv7(),
      workspaceId,
      url: request.url,
      secretHash: deriveSigningKey(secret),
      secretPrefix: secretPrefix(secret),
      eventTypes: request.eventTypes,
      description: request.description ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.unitOfWork.execute(async (tx) => {
      await tx.webhookSubscriptions.insert(subscription);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.webhookCreated,
        summary: `Added webhook endpoint ${subscription.url}`,
        payload: {
          subscriptionId: subscription.id,
          url: subscription.url,
          eventTypes: [...subscription.eventTypes],
        },
      });
      // The one moment the plaintext exists outside the caller's process.
      return { ...toWebhookSubscriptionDto(subscription), secret };
    });
  }

  async update(
    context: ActorContext,
    workspaceId: string,
    id: string,
    request: UpdateWebhookRequest,
  ): Promise<WebhookSubscriptionDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    return this.unitOfWork.execute(async (tx) => {
      const current = await this.require(tx, workspaceId, id);
      const next: WebhookSubscription = {
        ...current,
        url: request.url ?? current.url,
        eventTypes: request.eventTypes ?? current.eventTypes,
        description:
          request.description === undefined ? current.description : request.description,
        active: request.active ?? current.active,
        updatedAt: this.clock.now(),
      };

      await tx.webhookSubscriptions.update(next);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.webhookUpdated,
        summary: `Updated webhook endpoint ${next.url}`,
        payload: {
          subscriptionId: next.id,
          url: next.url,
          eventTypes: [...next.eventTypes],
          changes: changesBetween(current, next),
        },
      });
      return toWebhookSubscriptionDto(next);
    });
  }

  async delete(context: ActorContext, workspaceId: string, id: string): Promise<void> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    await this.unitOfWork.execute(async (tx) => {
      const current = await this.require(tx, workspaceId, id);
      await tx.webhookSubscriptions.delete(workspaceId, id);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.webhookDeleted,
        summary: `Removed webhook endpoint ${current.url}`,
        payload: { subscriptionId: current.id, url: current.url },
      });
    });
  }

  async listDeliveries(
    context: ActorContext,
    workspaceId: string,
    subscriptionId: string,
    query: ListWebhookDeliveriesQuery,
  ): Promise<WebhookDeliveryListResponse> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.require(tx, workspaceId, subscriptionId);
      const page = await tx.webhookDeliveries.listForSubscription(
        workspaceId,
        subscriptionId,
        this.toCursor(query),
      );
      return {
        data: page.items.map(toWebhookDeliveryDto),
        page: { hasMore: page.hasMore, nextCursor: this.nextCursor(page) },
      };
    });
  }

  /**
   * Send one synthetic delivery now and record the result. Not retried: the person
   * configuring the endpoint is watching, and a green tick minutes later is useless.
   */
  async test(
    context: ActorContext,
    workspaceId: string,
    id: string,
  ): Promise<WebhookDeliveryDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    const subscription = await this.unitOfWork.execute((tx) =>
      this.require(tx, workspaceId, id),
    );
    const now = this.clock.now();
    const deliveryId = uuidv7();
    const envelope = toEnvelope(
      {
        id: uuidv7(),
        schemaVersion: 1,
        eventType: WEBHOOK_TEST_EVENT,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        workspaceId,
        actor: { kind: context.actorKind, id: context.actorId },
        payload: { message: "This is a MorrowList test delivery." },
        correlationId: context.requestId,
        occurredAt: now,
      },
      { id: deliveryId, subscriptionId: subscription.id },
      1,
    );
    const body = JSON.stringify(envelope);
    const response = await this.sender.send({
      url: subscription.url,
      signingKey: subscription.secretHash,
      body,
      deliveryId,
      eventId: null,
      eventType: WEBHOOK_TEST_EVENT,
      attempt: 1,
      timestampSeconds: Math.floor(now.getTime() / 1000),
    });

    const ok =
      response.status !== null && response.status >= 200 && response.status < 300;
    const delivery: WebhookDelivery = {
      id: deliveryId,
      workspaceId,
      subscriptionId: subscription.id,
      outboxEventId: null,
      eventType: WEBHOOK_TEST_EVENT,
      status: ok ? "delivered" : "failed",
      attempt: 1,
      responseCode: response.status,
      error: ok ? null : (response.error ?? "delivery failed"),
      nextAttemptAt: null,
      deliveredAt: ok ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    await this.unitOfWork.execute((tx) => tx.webhookDeliveries.insert(delivery));
    return toWebhookDeliveryDto(delivery);
  }

  /**
   * Re-arm a dead-lettered delivery. The event is still in the outbox, so the next tick
   * picks it up with a fresh attempt budget: an endpoint that was down for a day can be
   * caught up by hand from the delivery log.
   */
  async retryDelivery(
    context: ActorContext,
    workspaceId: string,
    subscriptionId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.workspaceWrite);

    return this.unitOfWork.execute(async (tx) => {
      await this.require(tx, workspaceId, subscriptionId);
      const delivery = await tx.webhookDeliveries.findById(workspaceId, deliveryId);
      if (!delivery || delivery.subscriptionId !== subscriptionId) {
        throw new DomainError(
          "WEBHOOK_DELIVERY_NOT_FOUND",
          "No such webhook delivery.",
          { deliveryId },
        );
      }
      if (delivery.outboxEventId === null) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "A test delivery cannot be retried; send a new test instead.",
          { deliveryId },
        );
      }

      const now = this.clock.now();
      // `resetAttempts` restarts the counter, which is what makes the retry a fresh
      // budget of four rather than one last try.
      await tx.webhookDeliveries.recordOutcome({
        id: delivery.id,
        status: "pending",
        responseCode: null,
        error: null,
        nextAttemptAt: now,
        deliveredAt: null,
        updatedAt: now,
        resetAttempts: true,
      });
      return toWebhookDeliveryDto({
        ...delivery,
        attempt: 0,
        status: "pending",
        responseCode: null,
        error: null,
        nextAttemptAt: now,
        deliveredAt: null,
        updatedAt: now,
      });
    });
  }

  private async require(
    tx: TransactionContext,
    workspaceId: string,
    id: string,
  ): Promise<WebhookSubscription> {
    const subscription = await tx.webhookSubscriptions.findById(workspaceId, id);
    if (!subscription) {
      throw new DomainError("WEBHOOK_NOT_FOUND", "No such webhook endpoint.", {
        webhookId: id,
      });
    }
    return subscription;
  }

  private toCursor(query: { limit: number; cursor?: string | undefined }) {
    return {
      limit: query.limit,
      after: query.cursor
        ? decodeCursor(query.cursor, this.cursorSecret).i
        : undefined,
    };
  }

  private nextCursor(page: { items: readonly { id: string }[]; hasMore: boolean }) {
    const last = page.items.at(-1);
    return page.hasMore && last
      ? encodeCursor({ k: last.id, i: last.id }, this.cursorSecret)
      : null;
  }
}

/** The readable diff for the activity row. The secret is not a field, so it cannot leak. */
function changesBetween(
  previous: WebhookSubscription,
  next: WebhookSubscription,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (previous.url !== next.url) changes.url = { from: previous.url, to: next.url };
  if (previous.active !== next.active) {
    changes.active = { from: previous.active, to: next.active };
  }
  if (previous.description !== next.description) {
    changes.description = { from: previous.description, to: next.description };
  }
  if (previous.eventTypes.join(",") !== next.eventTypes.join(",")) {
    changes.eventTypes = {
      from: [...previous.eventTypes],
      to: [...next.eventTypes],
    };
  }
  return changes;
}
