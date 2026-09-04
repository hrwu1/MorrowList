-- Reviewed migration (spec 32).
--
-- Flow read model (GAP-17): one row per stay of a task in a workflow status, written in
-- the same transaction as the status change and rebuildable from activity_events with
-- `pnpm --filter @morrowlist/database db:backfill-flow`.
--
-- The partial unique index is the invariant the writers rely on: a task has at most one
-- open interval, the status it is in right now. The category is copied from the status
-- at entry so editing a status later does not rewrite history. Every foreign key
-- cascades because the rows are derived: nothing references them, and a hard-deleted
-- task, project or status takes its intervals with it.

CREATE TABLE "task_status_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"category" "workflow_status_category" NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "task_status_intervals_ordered" CHECK ("task_status_intervals"."left_at" IS NULL OR "task_status_intervals"."left_at" >= "task_status_intervals"."entered_at")
);
--> statement-breakpoint
ALTER TABLE "task_status_intervals" ADD CONSTRAINT "task_status_intervals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_status_intervals" ADD CONSTRAINT "task_status_intervals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_status_intervals" ADD CONSTRAINT "task_status_intervals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_status_intervals" ADD CONSTRAINT "task_status_intervals_status_id_workflow_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."workflow_statuses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "task_status_intervals_open_key" ON "task_status_intervals" USING btree ("task_id") WHERE "task_status_intervals"."left_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "task_status_intervals_task_idx" ON "task_status_intervals" USING btree ("task_id","entered_at");
--> statement-breakpoint
CREATE INDEX "task_status_intervals_project_idx" ON "task_status_intervals" USING btree ("project_id","left_at");
