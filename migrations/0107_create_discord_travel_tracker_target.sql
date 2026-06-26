CREATE TABLE IF NOT EXISTS discord_travel_tracker_target (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  faction_id INTEGER NOT NULL,
  faction_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_refreshed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

