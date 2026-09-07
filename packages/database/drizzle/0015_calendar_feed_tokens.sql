CREATE TABLE calendar_feed_tokens (
  user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (user_id, workspace_id)
);
CREATE UNIQUE INDEX calendar_feed_tokens_hash_idx ON calendar_feed_tokens(token_hash);
