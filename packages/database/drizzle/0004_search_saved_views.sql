-- Reviewed migration (spec 32).
--
-- Full-text search over tasks and personal saved views (spec 9.8, 18.4, GAP-02).
--
-- `search_vector` is a stored generated column so the application never writes it and it
-- can never drift from the title and description. The 'simple' configuration is chosen
-- deliberately: it does no language stemming, so a word matches the same way whatever
-- language a task is written in, and prefix matching (`term:*`) does the rest. The title
-- carries weight A and the description weight B, which `ts_rank_cd` uses to list a title
-- hit before a description hit. Tag names are matched through task_tags in the search
-- query rather than copied here, so renaming a tag never rewrites tasks.
--
-- `saved_views.rank` is COLLATE "C" for the same reason every other rank column is
-- (migration 0001). The unique index on lower(name) makes view names unique per owner
-- case-insensitively; Drizzle cannot express either, so this file is the source of truth.
--
-- The new enum value is not used inside this transaction; PostgreSQL forbids that.

ALTER TYPE "aggregate_type" ADD VALUE IF NOT EXISTS 'saved_view';
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', coalesce("description_md", '')), 'B')) STORED;
--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "tasks" USING gin ("search_vector");
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"filters" jsonb NOT NULL,
	"layout" varchar(10) NOT NULL,
	"rank" varchar(64) COLLATE "C" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saved_views_layout_check" CHECK ("layout" IN ('list', 'board'))
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_owner_name_key" ON "saved_views" USING btree ("workspace_id","owner_user_id",lower("name"));
--> statement-breakpoint
CREATE INDEX "saved_views_owner_rank_idx" ON "saved_views" USING btree ("workspace_id","owner_user_id","rank");
