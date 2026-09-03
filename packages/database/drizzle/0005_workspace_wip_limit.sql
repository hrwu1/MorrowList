-- Reviewed migration (spec 32).
--
-- A workspace may carry one "in progress" limit across every project (GAP-20): the
-- Personal Kanban rule that a person starts only so many things at once. Optional, so the
-- column is nullable and existing rows need no backfill. Reversible by dropping the column.

ALTER TABLE "workspaces" ADD COLUMN "in_progress_limit" integer;
