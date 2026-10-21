CREATE TABLE IF NOT EXISTS ranked_research_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  request_limit INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paused',
  cursor TEXT,
  discovery_done INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  message TEXT NOT NULL DEFAULT 'Ready to collect',
  snapshot_token TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ranked_research_reports (
  war_id INTEGER PRIMARY KEY,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  report_json TEXT,
  classification TEXT,
  fetched_at INTEGER
);
CREATE TABLE IF NOT EXISTS ranked_research_run_wars (
  run_id TEXT NOT NULL REFERENCES ranked_research_runs(id),
  war_id INTEGER NOT NULL REFERENCES ranked_research_reports(war_id),
  PRIMARY KEY (run_id, war_id)
);
CREATE TABLE IF NOT EXISTS ranked_research_cursors (
  run_id TEXT NOT NULL,
  cursor TEXT NOT NULL,
  PRIMARY KEY (run_id, cursor)
);
CREATE TABLE IF NOT EXISTS ranked_research_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ranked_research_attempt_owner ON ranked_research_attempts(owner_id, attempted_at);
CREATE TABLE IF NOT EXISTS ranked_research_analyses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ranked_research_runs(id),
  snapshot_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
