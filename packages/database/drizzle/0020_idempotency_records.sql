-- Replay records commit with their command. Response envelopes are encrypted by the
-- HTTP adapter, including capability URLs and one-time webhook credentials.
CREATE TABLE idempotency_records (
  scope_hash varchar(64) NOT NULL,
  key_hash varchar(64) NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_fingerprint varchar(64) NOT NULL,
  response_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope_hash, key_hash)
);
--> statement-breakpoint
CREATE INDEX idempotency_records_expiry_idx ON idempotency_records (expires_at);
