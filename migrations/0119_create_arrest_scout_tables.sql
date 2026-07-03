CREATE TABLE IF NOT EXISTS arrest_scout_snapshots (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_faction_id INTEGER,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  lookback_seconds INTEGER NOT NULL,
  min_counterfeiting_delta INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  settings_json TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  skill_100_count INTEGER NOT NULL DEFAULT 0,
  current_target_count INTEGER NOT NULL DEFAULT 0,
  future_target_count INTEGER NOT NULL DEFAULT 0,
  inactive_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS arrest_scout_results (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES arrest_scout_snapshots(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL,
  name TEXT,
  classification TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  current_forgeryskill INTEGER,
  current_counterfeiting INTEGER,
  historical_counterfeiting INTEGER,
  counterfeiting_delta INTEGER,
  current_jailed INTEGER,
  historical_jailed INTEGER,
  jailed_delta INTEGER,
  current_jailed_timestamp INTEGER,
  current_counterfeiting_timestamp INTEGER,
  current_forgeryskill_timestamp INTEGER,
  historical_jailed_timestamp INTEGER,
  historical_counterfeiting_timestamp INTEGER,
  historical_forgeryskill_timestamp INTEGER,
  lookback_seconds INTEGER NOT NULL,
  historical_timestamp_requested INTEGER NOT NULL,
  notes_json TEXT NOT NULL,
  current_personalstats_json TEXT,
  historical_personalstats_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS arrest_scout_future_targets (
  target_user_id INTEGER PRIMARY KEY,
  name TEXT,
  best_score INTEGER NOT NULL DEFAULT 0,
  last_classification TEXT NOT NULL,
  last_counterfeiting_delta INTEGER,
  last_jailed_delta INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  next_check_after INTEGER,
  latest_snapshot_id TEXT,
  notes_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_snapshots_scanned
  ON arrest_scout_snapshots(scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_results_snapshot_class_score
  ON arrest_scout_results(snapshot_id, classification, score DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_results_target_created
  ON arrest_scout_results(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_future_targets_due_score
  ON arrest_scout_future_targets(next_check_after ASC, best_score DESC);
