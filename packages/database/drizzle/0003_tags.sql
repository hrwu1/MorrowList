-- Reviewed migration (spec 32).
--
-- Workspace-scoped tags and the task–tag association (spec 12.1, 18.2, GAP-03).
--
-- `normalized_name` is the lower-cased, whitespace-collapsed form of `name`. It carries
-- the case-insensitive uniqueness constraint and is the column responses are ordered by,
-- so it is pinned to COLLATE "C" for the same reason `rank` is (migration 0001): the
-- order must not depend on the cluster locale, and it must match the code-point
-- comparison the in-memory test double uses. Drizzle does not model collation, so this
-- file is the source of truth for it.
--
-- Both foreign keys on task_tags cascade: deleting a tag removes its associations but
-- never a task (spec 12.1), and a hard-deleted task takes its associations with it.

CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"normalized_name" varchar(80) COLLATE "C" NOT NULL,
	"color_token" varchar(50) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_workspace_normalized_name_key" ON "tags" USING btree ("workspace_id","normalized_name");
--> statement-breakpoint
CREATE INDEX "task_tags_tag_idx" ON "task_tags" USING btree ("tag_id","task_id");
