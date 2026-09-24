CREATE TABLE IF NOT EXISTS managed_opencode_instances (
  session_id        TEXT PRIMARY KEY,
  parent_session_id TEXT,
  source_port       INTEGER NOT NULL,
  server_id         TEXT NOT NULL,
  host              TEXT NOT NULL,
  port              INTEGER NOT NULL,
  pid               INTEGER,
  directory         TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_managed_opencode_instances_parent
  ON managed_opencode_instances(parent_session_id);

CREATE INDEX IF NOT EXISTS idx_managed_opencode_instances_server
  ON managed_opencode_instances(server_id);
