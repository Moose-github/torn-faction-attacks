CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ranked_war_checked_at INTEGER,
  attacks_fetch_finished_at INTEGER,
  d1_writes_finished_at INTEGER,
  stats_finished_at INTEGER,
  report_finished_at INTEGER,
  heatmap_finished_at INTEGER,
  finished_at INTEGER,
  latest_attack_started INTEGER,
  fetched_pages INTEGER NOT NULL DEFAULT 0,
  fetched_attacks INTEGER NOT NULL DEFAULT 0,
  wrote_batches INTEGER NOT NULL DEFAULT 0,
  saw_rows INTEGER NOT NULL DEFAULT 0,
  active_war_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_started
  ON ingestion_runs(started_at DESC);
