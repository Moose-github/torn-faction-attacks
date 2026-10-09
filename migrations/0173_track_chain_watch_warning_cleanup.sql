-- Persist each warning cycle independently of the live chain timer so cleanup
-- can retry after further attacks, another cycle, or the end of monitoring.
CREATE TABLE chain_watch_warning_cycles (
  faction_id INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  timeout_at INTEGER NOT NULL,
  chain_length INTEGER NOT NULL,
  warning_message_id TEXT,
  warning_channel_id TEXT,
  critical_message_id TEXT,
  critical_channel_id TEXT,
  outcome_text TEXT,
  resolved_at INTEGER,
  edited_message_id TEXT,
  warning_deleted_at INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  PRIMARY KEY (faction_id, reset_at)
);

CREATE INDEX idx_attacks_chain_watch_hit_at
  ON attacks (attacker_faction_id, COALESCE(ended, started), id) WHERE chain > 0;
