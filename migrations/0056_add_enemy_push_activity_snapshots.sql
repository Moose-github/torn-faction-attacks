ALTER TABLE enemy_faction_members ADD COLUMN last_action_status TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN last_action_timestamp INTEGER;

CREATE TABLE IF NOT EXISTS enemy_push_activity_snapshots (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  total_members INTEGER NOT NULL,
  online_count INTEGER NOT NULL,
  idle_count INTEGER NOT NULL,
  offline_count INTEGER NOT NULL,
  recently_active_count INTEGER NOT NULL,
  offline_idle_to_online_count INTEGER NOT NULL,
  enemy_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  hospital_count INTEGER NOT NULL,
  revivable_count INTEGER NOT NULL,
  baseline_active_count REAL,
  activity_above_baseline REAL,
  online_delta_10m INTEGER NOT NULL DEFAULT 0,
  recently_active_delta_10m INTEGER NOT NULL DEFAULT 0,
  pressure_score INTEGER NOT NULL DEFAULT 0,
  pressure_level TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_enemy_push_activity_snapshots_war_bucket
  ON enemy_push_activity_snapshots(war_id, bucket_start);
