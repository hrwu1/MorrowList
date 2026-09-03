-- Reviewed migration (spec 32).
--
-- Task relationships and the explicit blocker flag (spec 8.4, 18.4, GAP-06).
--
-- `task_relations` stores `blocks` (directed, source must finish before target is
-- unblocked) and `related_to` (symmetric, stored once with the endpoints in id order).
-- The `task_relation_type` enum already exists from 0000_init; adding a reserved type
-- such as `duplicates` later is an ALTER TYPE ... ADD VALUE forward migration.
--
-- Both task foreign keys cascade: a hard-deleted task (after Trash retention) takes its
-- relations with it, while a soft-deleted task keeps them and the read side hides them.
--
-- The blocker flag lives on the task itself so a task stays in its real column while
-- saying why it cannot move; the reason and its start time are set and cleared together.

ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason_with_since" CHECK (("tasks"."blocked_reason" IS NULL) = ("tasks"."blocked_since" IS NULL));
--> statement-breakpoint
CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"target_task_id" uuid NOT NULL,
	"type" "task_relation_type" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_actor_kind" "actor_kind" NOT NULL,
	"created_by_actor_id" varchar(200) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_relations_no_self" CHECK ("task_relations"."source_task_id" <> "task_relations"."target_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_source_task_id_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_target_task_id_tasks_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "task_relations_edge_key" ON "task_relations" USING btree ("source_task_id","target_task_id","type");
--> statement-breakpoint
CREATE INDEX "task_relations_source_idx" ON "task_relations" USING btree ("source_task_id");
--> statement-breakpoint
CREATE INDEX "task_relations_target_idx" ON "task_relations" USING btree ("target_task_id");
