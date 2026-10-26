-- Immutable observations, separate from Discord delivery and message cleanup.
-- Assignment fields are snapshots, not foreign keys: later edits must not
-- reattribute or remove recorded events.
CREATE TABLE chain_watch_threshold_events (
  faction_id INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('warning_60', 'warning_30')),
  timeout_at INTEGER NOT NULL,
  chain_length INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  watch_id TEXT,
  slot_start_at INTEGER,
  assigned_to INTEGER,
  assignment_revision INTEGER,
  PRIMARY KEY (faction_id, reset_at, stage)
);

CREATE INDEX idx_chain_watch_threshold_events_watch
  ON chain_watch_threshold_events (watch_id, slot_start_at, assigned_to, stage);
CREATE INDEX idx_chain_watch_threshold_events_member
  ON chain_watch_threshold_events (assigned_to, observed_at);
