-- Token is derived with a deployment secret; only its SHA-256 digest is stored.
CREATE TABLE inbound_addresses (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX inbound_addresses_current_idx ON inbound_addresses(workspace_id, user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Keep receipts when a task is deleted so provider retries cannot recreate it.
CREATE TABLE inbound_receipts (
  address_id uuid NOT NULL REFERENCES inbound_addresses(id) ON DELETE CASCADE,
  message_key text NOT NULL,
  task_id uuid NOT NULL,
  PRIMARY KEY(address_id, message_key)
);
