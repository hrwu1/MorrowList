-- Task-key prefixes are stored as typed and may be up to 24 characters, so a workspace
-- name no longer has to be truncated into a short uppercase code.
ALTER TABLE "workspaces" ALTER COLUMN "task_key_prefix" TYPE varchar(24);
