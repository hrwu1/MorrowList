-- Reviewed migration (spec 32).
--
-- Start/defer dates and deadlines (GAP-16). `defer_until` hides a task from Today,
-- Upcoming, the Inbox and the board until that day; `deadline` is the hard limit,
-- distinct from the planned `due_date`. All three are date-only and are compared with
-- the workspace's calendar date at read time, so nothing rewrites a row when the day
-- arrives. `deadline_time` is a wall-clock time in the workspace timezone and, like
-- `due_time`, cannot exist without its date.
--
-- The two indexes are partial: only live, open rows carrying the date are ever read by
-- the deferred/deadline filters and the Today and Upcoming predicates.

ALTER TABLE "tasks" ADD COLUMN "defer_until" date;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deadline" date;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deadline_time" time;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deadline_time_requires_date" CHECK ("tasks"."deadline_time" IS NULL OR "tasks"."deadline" IS NOT NULL);
--> statement-breakpoint
CREATE INDEX "tasks_defer_idx" ON "tasks" USING btree ("workspace_id","defer_until") WHERE "tasks"."deleted_at" IS NULL AND "tasks"."completed_at" IS NULL AND "tasks"."defer_until" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "tasks_deadline_idx" ON "tasks" USING btree ("workspace_id","deadline") WHERE "tasks"."deleted_at" IS NULL AND "tasks"."completed_at" IS NULL AND "tasks"."deadline" IS NOT NULL;
