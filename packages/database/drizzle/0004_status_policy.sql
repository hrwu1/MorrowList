-- Reviewed migration (spec 32).
--
-- Workflow columns may carry a short policy in Markdown (spec 11.3): the explicit
-- definition of done or the rule for entering a column. It is optional, so the column is
-- nullable and existing rows need no backfill. Reversible by dropping the column.

ALTER TABLE "workflow_statuses" ADD COLUMN "policy_md" text;
