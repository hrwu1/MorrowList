-- GAP-25: CalDAV resources a client has written. One row per (task, resource) where a
-- client chose the resource name or sent iCalendar properties MorrowList does not model;
-- tasks without a row are served under their id with generated properties.
CREATE TABLE caldav_objects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource varchar(20) NOT NULL,
  path text NOT NULL,
  uid text NOT NULL,
  properties jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, task_id, resource)
);
CREATE UNIQUE INDEX caldav_objects_path_idx ON caldav_objects(workspace_id, path);
CREATE UNIQUE INDEX caldav_objects_uid_idx ON caldav_objects(workspace_id, uid);
-- sync-collection reads every task changed since a token, trashed ones included.
CREATE INDEX tasks_workspace_updated_idx ON tasks(workspace_id, updated_at);
