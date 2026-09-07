CREATE TABLE rules (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name varchar(150) NOT NULL, trigger jsonb NOT NULL, conditions jsonb NOT NULL,
 actions jsonb NOT NULL, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX rules_workspace_idx ON rules(workspace_id, id);
CREATE TABLE rule_runs (
 id uuid PRIMARY KEY, rule_id uuid NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
 task_id uuid NOT NULL, event_key text NOT NULL,
 outbox_event_id uuid REFERENCES outbox_events(id) ON DELETE SET NULL,
 status varchar(20) NOT NULL CHECK (status IN ('succeeded', 'skipped', 'failed')),
 error text, ran_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX rule_runs_event_idx ON rule_runs(rule_id, event_key);
CREATE INDEX rule_runs_log_idx ON rule_runs(rule_id, ran_at DESC, id DESC);
-- Independent consumer: publication belongs to webhooks, never to rule eligibility.
CREATE INDEX outbox_events_rules_idx ON outbox_events(workspace_id, event_type, occurred_at, id)
 WHERE aggregate_type = 'task' AND causation_id IS NULL;
