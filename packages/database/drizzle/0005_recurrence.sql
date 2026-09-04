-- Reviewed migration (spec 32).
--
-- Recurring tasks (GAP-12). A task may carry a recurrence rule; completing it creates the
-- next occurrence in the same transaction and the rule moves to that new task. Every
-- occurrence shares the `series_id` of the first, so a series can be listed as a whole.
--
-- `recurrence` is JSONB holding the canonical rule the contract and the domain validate
-- before any write; the column stays schemaless so a new rule part is a code change, not a
-- migration. Neither column is backfilled: an existing task simply does not repeat.

ALTER TABLE "tasks" ADD COLUMN "recurrence" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" uuid;
--> statement-breakpoint
CREATE INDEX "tasks_series_idx" ON "tasks" USING btree ("workspace_id","series_id");
