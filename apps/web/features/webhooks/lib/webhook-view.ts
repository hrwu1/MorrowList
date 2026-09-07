import { RULE_ONLY_WEBHOOK_EVENT } from "@morrowlist/contracts";
import type { WebhookDeliveryDto, WebhookSubscriptionDto } from "@morrowlist/contracts";

/**
 * Pure presentation rules for webhook endpoints and their delivery log (GAP-18).
 *
 * Nothing here ever sees a secret: the API returns only the prefix, so there is nothing
 * to redact in the component.
 */

/** The event groups the form offers. `*` is deliberately first: it is the useful default. */
export const EVENT_PRESETS = [
  { value: "*", label: "Everything" },
  { value: RULE_ONLY_WEBHOOK_EVENT, label: "Only when called by a rule" },
  { value: "task.*", label: "All task events" },
  { value: "task.created,task.updated,task.completed", label: "Task lifecycle" },
  { value: "project.*,workflow_status.*", label: "Projects and columns" },
] as const;

export type DeliveryTone = "success" | "pending" | "error";

export function deliveryTone(delivery: WebhookDeliveryDto): DeliveryTone {
  if (delivery.status === "delivered") return "success";
  return delivery.status === "pending" ? "pending" : "error";
}

/** One sentence a person can act on, rather than a status word and a number. */
export function describeDelivery(delivery: WebhookDeliveryDto): string {
  if (delivery.status === "delivered") {
    return `Delivered${delivery.responseCode ? ` (${delivery.responseCode})` : ""}`;
  }
  if (delivery.status === "pending") {
    return delivery.attempt === 0
      ? "Queued"
      : `Attempt ${delivery.attempt} failed, retrying`;
  }
  return `Gave up after ${delivery.attempt} attempt${delivery.attempt === 1 ? "" : "s"}`;
}

/** What went wrong, short enough for a table cell and never a secret. */
export function deliveryDetail(delivery: WebhookDeliveryDto): string {
  if (delivery.error) return delivery.error;
  if (delivery.responseCode !== null) return `HTTP ${delivery.responseCode}`;
  return "—";
}

export function describeEndpoint(webhook: WebhookSubscriptionDto): string {
  if (
    webhook.eventTypes.length === 1 &&
    webhook.eventTypes[0] === RULE_ONLY_WEBHOOK_EVENT
  )
    return `${webhook.active ? "Active" : "Paused"} · Only when called by a rule`;
  const events =
    webhook.eventTypes.length === 1 && webhook.eventTypes[0] === "*"
      ? "every event"
      : webhook.eventTypes.join(", ");
  return `${webhook.active ? "Active" : "Paused"} · ${events}`;
}

/** Split a comma-separated list the way the form and the CLI both accept it. */
export function parseEventTypes(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
