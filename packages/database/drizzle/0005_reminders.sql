-- Reviewed migration (spec 32).
--
-- Reminders and notifications (GAP-13; the `notifications` table of spec 18.4).
--
-- `tasks.reminder_offset_minutes` is the user's setting (null = no reminder) and needs a
-- due time, like the due time needs a due date. `task_reminders` is the derived schedule:
-- one row per task, recomputed by the application from the canonical task, claimed by the
-- worker through the partial index on pending rows. Both cascade with the task; a
-- notification only loses its task link so what the user was told stays readable.

ALTER TABLE "tasks" ADD COLUMN "reminder_offset_minutes" integer;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reminder_requires_due_time" CHECK ("tasks"."reminder_offset_minutes" IS NULL OR "tasks"."due_time" IS NOT NULL);
--> statement-breakpoint
CREATE TABLE "task_reminders" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"offset_minutes" integer NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"task_id" uuid,
	"title" varchar(500) NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channels" jsonb NOT NULL,
	"digest_time" time,
	"timezone" varchar(100),
	"default_offset_minutes" integer DEFAULT 30 NOT NULL,
	"last_digest_date" date,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_preferences_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_user_id_endpoint_pk" PRIMARY KEY("user_id","endpoint")
);
--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "task_reminders_pending_idx" ON "task_reminders" USING btree ("remind_at") WHERE "task_reminders"."delivered_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","workspace_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","workspace_id") WHERE "notifications"."read_at" IS NULL;
