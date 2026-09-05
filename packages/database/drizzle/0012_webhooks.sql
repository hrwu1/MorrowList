-- Reviewed migration (spec 32).
--
-- Webhook delivery (GAP-18; the `webhook_subscriptions` and `webhook_deliveries` tables
-- of spec 18.4).
--
-- The outbox stays the source of truth for what happened. `webhook_deliveries` records
-- who was told and how it went, one row per (subscription, event). The unique index is
-- load-bearing: the dispatcher re-runs its fan-out on every tick until the outbox row is
-- published, and several dispatchers may run at once, so the second insert must be a
-- no-op rather than a duplicate delivery. A test delivery has no outbox row, and because
-- PostgreSQL treats NULLs in a unique index as distinct, repeated tests are allowed.
--
-- `secret_hash` is the SHA-256 of the secret shown to the user once, and is also the key
-- deliveries are signed with, so the plaintext is never stored (docs/api/webhooks.md).

CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_prefix" varchar(20) NOT NULL,
	"event_types" text[] NOT NULL,
	"description" varchar(200),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"outbox_event_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "webhook_deliveries_status" CHECK ("webhook_deliveries"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_active_idx" ON "webhook_subscriptions" USING btree ("workspace_id","created_at") WHERE "webhook_subscriptions"."active";
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("subscription_id","outbox_event_id");
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at","id") WHERE "webhook_deliveries"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_log_idx" ON "webhook_deliveries" USING btree ("subscription_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
