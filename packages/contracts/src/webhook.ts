import { z } from "zod";

import { paginated, paginationQuerySchema, uuidSchema } from "./common.js";

/**
 * Webhook transport schemas (GAP-18, spec 18.4 `webhook_subscriptions` /
 * `webhook_deliveries`, spec 19.6 envelope).
 *
 * A subscription's secret is returned exactly once, by the create call. Every later read
 * carries only the prefix, because the server keeps a digest and cannot show the rest.
 */

/** `*` subscribes to everything, including event types added after the subscription. */
export const WEBHOOK_EVENT_WILDCARD = "*";

const eventTypeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^(\*|[a-z_]+\.(\*|[a-z_]+))$/,
    "must be an event type such as task.completed, a prefix such as task.*, or *",
  );

/** Only `https` in production; `http` is allowed so a local receiver can be tested. */
export const webhookUrlSchema = z
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://") || value.startsWith("http://"), {
    message: "must be an http(s) URL",
  });

export const webhookDeliveryStatusSchema = z.enum([
  /** Waiting for its next attempt. */
  "pending",
  /** The endpoint answered 2xx. */
  "delivered",
  /** Every attempt failed; dead-lettered until someone retries it. */
  "failed",
]);

export const webhookSubscriptionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  url: z.string(),
  /** Event types or prefixes this endpoint receives. */
  eventTypes: z.array(z.string()),
  description: z.string().nullable(),
  active: z.boolean(),
  /** The readable head of the signing secret, for telling two subscriptions apart. */
  secretPrefix: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** The create response, and the only time the full secret is ever returned. */
export const createdWebhookSubscriptionSchema = webhookSubscriptionSchema.extend({
  secret: z.string(),
});

export const createWebhookRequestSchema = z.object({
  url: webhookUrlSchema,
  eventTypes: z.array(eventTypeSchema).min(1).max(50).default([WEBHOOK_EVENT_WILDCARD]),
  description: z.string().max(200).nullable().optional(),
});

export const updateWebhookRequestSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    eventTypes: z.array(eventTypeSchema).min(1).max(50).optional(),
    description: z.string().max(200).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field must be supplied",
  });

export const webhookDeliverySchema = z.object({
  id: uuidSchema,
  subscriptionId: uuidSchema,
  /** Null for a test delivery, which has no outbox row behind it. */
  eventId: uuidSchema.nullable(),
  eventType: z.string(),
  status: webhookDeliveryStatusSchema,
  /** Attempts made so far; the dispatcher stops after four. */
  attempt: z.number().int().nonnegative(),
  responseCode: z.number().int().nullable(),
  /** A short reason, safe to display; never carries a secret or a signature. */
  error: z.string().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const listWebhookDeliveriesQuerySchema = paginationQuerySchema;

export const webhookSubscriptionResponseSchema = z.object({
  data: webhookSubscriptionSchema,
});
export const createdWebhookSubscriptionResponseSchema = z.object({
  data: createdWebhookSubscriptionSchema,
});
export const webhookSubscriptionListResponseSchema = paginated(
  webhookSubscriptionSchema,
);
export const webhookDeliveryResponseSchema = z.object({ data: webhookDeliverySchema });
export const webhookDeliveryListResponseSchema = paginated(webhookDeliverySchema);

export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;
export type WebhookSubscriptionDto = z.infer<typeof webhookSubscriptionSchema>;
export type CreatedWebhookSubscriptionDto = z.infer<
  typeof createdWebhookSubscriptionSchema
>;
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;
export type ListWebhookDeliveriesQuery = z.infer<
  typeof listWebhookDeliveriesQuerySchema
>;
export type WebhookSubscriptionListResponse = z.infer<
  typeof webhookSubscriptionListResponseSchema
>;
export type WebhookDeliveryListResponse = z.infer<
  typeof webhookDeliveryListResponseSchema
>;

/**
 * What a subscriber receives (spec 19.6). `payload` is the stored event payload, passed
 * through unchanged — for `task.updated` that means the `changes` diff the command
 * recorded, so a subscriber can see what moved without re-reading the task.
 */
export const webhookDeliveryEnvelopeSchema = z.object({
  id: uuidSchema,
  schemaVersion: z.number().int().positive(),
  type: z.string(),
  aggregateType: z.string(),
  aggregateId: uuidSchema,
  workspaceId: uuidSchema,
  actor: z.object({ kind: z.string(), id: z.string() }),
  occurredAt: z.iso.datetime(),
  correlationId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  delivery: z.object({
    id: uuidSchema,
    subscriptionId: uuidSchema,
    attempt: z.number().int().positive(),
  }),
});

export type WebhookDeliveryEnvelope = z.infer<typeof webhookDeliveryEnvelopeSchema>;

/** Header names a receiver reads. Fixed here so the docs and the sender cannot drift. */
export const WEBHOOK_HEADERS = {
  /** `t=<unix seconds>,v1=<hex hmac>` over `<t>.<raw body>`. */
  signature: "Morrow-Signature",
  delivery: "Morrow-Delivery",
  event: "Morrow-Event",
  eventType: "Morrow-Event-Type",
  attempt: "Morrow-Attempt",
} as const;

/** Reject a delivery whose timestamp is further from now than this (spec 26.1). */
export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;
