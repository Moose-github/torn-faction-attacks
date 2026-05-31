CREATE TABLE IF NOT EXISTS chain_watch_state (
  war_id INTEGER PRIMARY KEY REFERENCES wars(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'stored',
  current_chain INTEGER,
  reset_at INTEGER,
  timeout_at INTEGER,
  last_hit_id INTEGER,
  last_hit_at INTEGER,
  last_hit_attacker_name TEXT,
  last_hit_defender_name TEXT,
  last_hit_result TEXT,
  scheduled_alarm_stage TEXT,
  scheduled_alarm_at INTEGER,
  warning_60_sent_at INTEGER,
  warning_30_sent_at INTEGER,
  drop_sent_at INTEGER,
  alert_chain INTEGER,
  alert_reset_at INTEGER,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chain_watch_state_enabled
  ON chain_watch_state (enabled, timeout_at);
