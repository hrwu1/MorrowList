CREATE TYPE "public"."actor_kind" AS ENUM('user', 'api_key', 'system', 'integration', 'agent');--> statement-breakpoint
CREATE TYPE "public"."aggregate_type" AS ENUM('task', 'project', 'status', 'tag', 'workspace');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_relation_type" AS ENUM('blocks', 'related_to');--> statement-breakpoint
CREATE TYPE "public"."workflow_status_category" AS ENUM('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_task_counters" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"next_number" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"task_key_prefix" varchar(10) NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description_md" text,
	"color_token" varchar(50) NOT NULL,
	"icon" varchar(80),
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_actor_kind" varchar(30) NOT NULL,
	"created_by_actor_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"category" "workflow_status_category" NOT NULL,
	"rank" varchar(64) NOT NULL,
	"color_token" varchar(50) NOT NULL,
	"wip_limit" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_day_plans" (
	"task_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	"created_by_actor_kind" "actor_kind" NOT NULL,
	"created_by_actor_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_number" bigint NOT NULL,
	"project_id" uuid,
	"status_id" uuid,
	"title" varchar(500) NOT NULL,
	"description_md" text,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"due_date" date,
	"due_time" time,
	"due_timezone" varchar(100),
	"parent_task_id" uuid,
	"rank" varchar(64) NOT NULL,
	"last_active_status_id" uuid,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_actor_kind" "actor_kind" NOT NULL,
	"created_by_actor_id" varchar(200) NOT NULL,
	"last_actor_kind" "actor_kind" NOT NULL,
	"last_actor_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_actor_kind" "actor_kind",
	"deleted_by_actor_id" varchar(200),
	CONSTRAINT "tasks_due_time_requires_date" CHECK ("tasks"."due_time" IS NULL OR "tasks"."due_date" IS NOT NULL),
	CONSTRAINT "tasks_inbox_has_no_status" CHECK ("tasks"."project_id" IS NOT NULL OR "tasks"."status_id" IS NULL),
	CONSTRAINT "tasks_no_self_parent" CHECK ("tasks"."parent_task_id" IS NULL OR "tasks"."parent_task_id" <> "tasks"."id"),
	CONSTRAINT "tasks_version_positive" CHECK ("tasks"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"aggregate_type" "aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" varchar(200) NOT NULL,
	"actor_display_name" varchar(200),
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"aggregate_type" "aggregate_type" NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"actor" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" varchar(200) NOT NULL,
	"causation_id" varchar(200),
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_task_counters" ADD CONSTRAINT "workspace_task_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_day_plans" ADD CONSTRAINT "task_day_plans_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_workflow_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."workflow_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_key" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_name_key" ON "projects" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "projects_workspace_archived_idx" ON "projects" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "workflow_statuses_project_rank_idx" ON "workflow_statuses" USING btree ("project_id","archived_at","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_statuses_one_default_idx" ON "workflow_statuses" USING btree ("project_id") WHERE "workflow_statuses"."is_default" AND "workflow_statuses"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_day_plans_pk" ON "task_day_plans" USING btree ("task_id","plan_date");--> statement-breakpoint
CREATE INDEX "task_day_plans_date_idx" ON "task_day_plans" USING btree ("plan_date","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_workspace_number_key" ON "tasks" USING btree ("workspace_id","task_number");--> statement-breakpoint
CREATE INDEX "tasks_workspace_state_idx" ON "tasks" USING btree ("workspace_id","deleted_at","completed_at");--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("project_id","status_id","rank");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("workspace_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "activity_events_aggregate_idx" ON "activity_events" USING btree ("workspace_id","aggregate_type","aggregate_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" USING btree ("available_at","id") WHERE "outbox_events"."published_at" IS NULL;