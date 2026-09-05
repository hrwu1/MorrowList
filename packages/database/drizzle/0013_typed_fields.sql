-- Reviewed migration (spec 32).
--
-- A few typed custom fields (GAP-24; the ADR on typed fields).
--
-- `field_definitions` holds a workspace's at-most-ten fields. `key` is the stable
-- identifier a value map, a filter expression, a CLI flag and an export all carry, so it
-- is unique per workspace and narrow by construction; `name` is free to be renamed.
-- `rank` is COLLATE "C" for the same reason every other rank column is (migration 0001):
-- ordering must be by code point, not by the cluster locale. The four types are pinned by
-- a check constraint rather than a new enum, because a type list this small changes by
-- product decision and a check is reversible by a forward migration.
--
-- The values live in `tasks.fields`, one jsonb object keyed by `key`, so a task remains
-- one row and one model (ADR-001) and every projection reads the values from the task it
-- had already loaded. The GIN index is what makes the equality filter — `fields @>
-- '{"key": value}'` — an index scan rather than a scan of the workspace; the ordering
-- operators (`->` compared against a jsonb literal) fall back to the workspace's rows,
-- which is the same budget the existing priority filter spends.
--
-- The new enum value is not used inside this transaction; PostgreSQL forbids that.

ALTER TYPE "aggregate_type" ADD VALUE IF NOT EXISTS 'field';
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE INDEX "tasks_fields_idx" ON "tasks" USING gin ("fields");
--> statement-breakpoint
CREATE TABLE "field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" varchar(10) NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" varchar(64) COLLATE "C" NOT NULL,
	"show_on_card" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "field_definitions_type_check" CHECK ("type" IN ('select', 'number', 'date', 'text'))
);
--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_workspace_key" ON "field_definitions" USING btree ("workspace_id","key");
--> statement-breakpoint
CREATE INDEX "field_definitions_rank_idx" ON "field_definitions" USING btree ("workspace_id","rank");
