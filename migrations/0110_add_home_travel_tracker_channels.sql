CREATE TABLE IF NOT EXISTS discord_travel_tracker_state_next (
  tracker_key TEXT PRIMARY KEY CHECK (tracker_key IN ('target', 'home')),
  enabled INTEGER NOT NULL DEFAULT 1,
  war_id INTEGER,
  target_source TEXT,
  faction_id INTEGER,
  destination_key TEXT,
  message_id TEXT,
  content_hash TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO discord_travel_tracker_state_next (
  tracker_key,
  enabled,
  war_id,
  target_source,
  faction_id,
  destination_key,
  message_id,
  content_hash,
  last_synced_at,
  created_at,
  updated_at
)
SELECT
  'target',
  1,
  war_id,
  target_source,
  faction_id,
  destination_key,
  message_id,
  content_hash,
  last_synced_at,
  created_at,
  updated_at
FROM discord_travel_tracker_state
WHERE id = 1;

INSERT OR IGNORE INTO discord_travel_tracker_state_next (
  tracker_key,
  enabled
)
VALUES
  ('target', 1),
  ('home', 0);

DROP TABLE discord_travel_tracker_state;

ALTER TABLE discord_travel_tracker_state_next
  RENAME TO discord_travel_tracker_state;

ALTER TABLE home_faction_members
  ADD COLUMN plane_image_type TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_origin TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_destination TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_signature TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_detected_at INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN travel_started_after INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN travel_started_before INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN estimated_arrival_at INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN estimated_arrival_earliest INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN estimated_arrival_latest INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN travel_trip_destination TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_trip_type TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN travel_trip_inferred_at INTEGER;
