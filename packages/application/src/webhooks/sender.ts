import { WEBHOOK_HEADERS, type WebhookDeliveryEnvelope } from "@morrowlist/contracts";

import { signPayload } from "./signature.js";

/**
 * The one side-effect the dispatcher has: an outbound HTTP POST. It is a port so the
 * tests can drive a failing endpoint, a slow endpoint, and a replay without a server, and
 * so a deployment could swap in a proxy without touching the dispatcher.
 */

export interface WebhookRequest {
  readonly url: string;
  /** SHA-256 of the subscriber's secret; a credential, never logged. */
  readonly signingKey: string;
  readonly body: string;
  readonly deliveryId: string;
  readonly eventId: string | null;
  readonly eventType: string;
  readonly attempt: number;
  readonly timestampSeconds: number;
}

export interface WebhookResponse {
  /** Null when the request never got an HTTP answer (DNS, TLS, timeout). */
  readonly status: number | null;
  /** A short reason for the log; the body of a failing response is not kept. */
  readonly error: string | null;
}

export interface WebhookSender {
  send(request: WebhookRequest): Promise<WebhookResponse>;
}

export function webhookHeaders(request: WebhookRequest): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "MorrowList-Webhooks/1",
    [WEBHOOK_HEADERS.signature]: signPayload(
      request.signingKey,
      request.body,
      request.timestampSeconds,
    ),
    [WEBHOOK_HEADERS.delivery]: request.deliveryId,
    [WEBHOOK_HEADERS.eventType]: request.eventType,
    [WEBHOOK_HEADERS.attempt]: String(request.attempt),
    ...(request.eventId ? { [WEBHOOK_HEADERS.event]: request.eventId } : {}),
  };
}

/** Build the spec 19.6 envelope a subscriber receives. */
export function toEnvelope(
  event: {
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
  },
  delivery: { readonly id: string; readonly subscriptionId: string },
  attempt: number,
): WebhookDeliveryEnvelope {
  return {
    id: event.id,
    schemaVersion: event.schemaVersion,
    type: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    workspaceId: event.workspaceId,
    actor: event.actor,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    payload: event.payload,
    delivery: { id: delivery.id, subscriptionId: delivery.subscriptionId, attempt },
  };
}
