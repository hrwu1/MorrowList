-- Reviewed migration (spec 32).
--
-- Manual ordering uses base-62 fractional rank keys whose alphabet is ordered by ASCII
-- code point: digits < uppercase < lowercase. Under the cluster's default locale-aware
-- collation, PostgreSQL sorts 'aa' before 'aZ', which silently reverses the intended
-- order of two adjacent cards on a board.
--
-- Verified on PostgreSQL 18 with an en_US.UTF-8 cluster:
--   select v from (values ('a0'),('a9'),('aZ'),('aa')) t(v) order by v;
--     -> a0, a9, aa, aZ          (wrong)
--   ... order by v collate "C";
--     -> a0, a9, aZ, aa          (correct)
--
-- Pinning the column collation rather than adding COLLATE at every call site means a
-- query that forgets the clause still sorts correctly.

ALTER TABLE "tasks" ALTER COLUMN "rank" TYPE varchar(64) COLLATE "C";
--> statement-breakpoint
ALTER TABLE "workflow_statuses" ALTER COLUMN "rank" TYPE varchar(64) COLLATE "C";
--> statement-breakpoint
-- The indexes covering rank must be rebuilt so they use the new collation.
DROP INDEX IF EXISTS "tasks_board_idx";
--> statement-breakpoint
CREATE INDEX "tasks_board_idx" ON "tasks" USING btree ("project_id","status_id","rank");
--> statement-breakpoint
DROP INDEX IF EXISTS "workflow_statuses_project_rank_idx";
--> statement-breakpoint
CREATE INDEX "workflow_statuses_project_rank_idx" ON "workflow_statuses" USING btree ("project_id","archived_at","rank");
