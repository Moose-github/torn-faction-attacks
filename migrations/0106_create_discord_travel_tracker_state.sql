CREATE TABLE IF NOT EXISTS discord_travel_tracker_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  war_id INTEGER,
  message_id TEXT,
  content_hash TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

