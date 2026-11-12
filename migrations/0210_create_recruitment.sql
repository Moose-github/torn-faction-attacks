CREATE TABLE recruitment_scan (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','paused','completed','failed')),
  next_offset INTEGER NOT NULL DEFAULT 0,
  pages_saved INTEGER NOT NULL DEFAULT 0,
  players_saved INTEGER NOT NULL DEFAULT 0,
  calls_used INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  retry_at INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_value INTEGER
);
INSERT INTO recruitment_scan(id) VALUES(1);

CREATE TABLE recruitment_work_stats (
  player_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  total_work_stats INTEGER NOT NULL,
  hof_position INTEGER NOT NULL,
  work_stats_checked_at INTEGER NOT NULL
);
CREATE INDEX idx_recruitment_stats ON recruitment_work_stats(total_work_stats DESC, player_id);

-- Reservations persist across ticks, retries, pauses and new scans.
CREATE TABLE recruitment_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  offset INTEGER NOT NULL
);
CREATE INDEX idx_recruitment_attempt_key ON recruitment_attempts(key_id, attempted_at);

CREATE TABLE recruitment_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  imported_at INTEGER NOT NULL,
  total_players INTEGER NOT NULL,
  unemployed INTEGER NOT NULL,
  city_jobs INTEGER NOT NULL,
  excluded_fed INTEGER NOT NULL
);
CREATE TABLE recruitment_snapshot_players (
  snapshot_id TEXT NOT NULL REFERENCES recruitment_snapshots(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  city_job TEXT,
  level INTEGER NOT NULL,
  faction_id INTEGER,
  PRIMARY KEY(snapshot_id, player_id)
);
CREATE INDEX idx_recruitment_snapshot_job ON recruitment_snapshot_players(snapshot_id, city_job, player_id);
CREATE TABLE recruitment_current_snapshot (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  snapshot_id TEXT REFERENCES recruitment_snapshots(id)
);
INSERT INTO recruitment_current_snapshot(id) VALUES(1);
