import { RULE_ONLY_WEBHOOK_EVENT } from "@morrowlist/contracts";
import type { WebhookDeliveryDto, WebhookSubscriptionDto } from "@morrowlist/contracts";

import type { WebhookDelivery, WebhookSubscription } from "../ports/index.js";

/** Domain-to-contract mapping for webhooks (GAP-18). The signing key never crosses. */

export function toWebhookSubscriptionDto(
  subscription: WebhookSubscription,
): WebhookSubscriptionDto {
  return {
    id: subscription.id,
    workspaceId: subscription.workspaceId,
    url: subscription.url,
    eventTypes: [...subscription.eventTypes],
    description: subscription.description,
    active: subscription.active,
    secretPrefix: subscription.secretPrefix,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

export function toWebhookDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
  return {
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    eventId: delivery.outboxEventId,
    eventType: delivery.eventType,
    status: delivery.status,
    attempt: delivery.attempt,
    responseCode: delivery.responseCode,
    error: delivery.error,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
  };
}

/**
 * Does this subscription want this event? An entry is an exact type, an aggregate prefix
 * such as `task.*`, or `*` for everything including types added later.
 */
export function matchesEventType(
  eventTypes: readonly string[],
  eventType: string,
): boolean {
  if (eventTypes.includes(RULE_ONLY_WEBHOOK_EVENT)) return false;
  return eventTypes.some((pattern) => {
    if (pattern === "*" || pattern === eventType) return true;
    if (!pattern.endsWith(".*")) return false;
    return eventType.startsWith(pattern.slice(0, -1));
  });
}
