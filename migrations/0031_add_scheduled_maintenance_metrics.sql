ALTER TABLE ingestion_runs ADD COLUMN attack_write_statements INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN sync_state_writes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN stat_write_operations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN report_write_operations INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS scheduled_maintenance_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  task_count INTEGER NOT NULL DEFAULT 0,
  write_statements INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_maintenance_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  write_statements INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  error TEXT,
  FOREIGN KEY (run_id) REFERENCES scheduled_maintenance_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_maintenance_runs_started
  ON scheduled_maintenance_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_maintenance_tasks_run
  ON scheduled_maintenance_tasks(run_id);
