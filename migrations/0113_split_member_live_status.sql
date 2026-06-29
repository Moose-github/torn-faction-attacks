CREATE TABLE IF NOT EXISTS home_member_live_status (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  is_revivable INTEGER,
  status_state TEXT,
  status_description TEXT,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  plane_image_type TEXT,
  travel_origin TEXT,
  travel_destination TEXT,
  travel_signature TEXT,
  travel_detected_at INTEGER,
  travel_started_after INTEGER,
  travel_started_before INTEGER,
  estimated_arrival_at INTEGER,
  estimated_arrival_earliest INTEGER,
  estimated_arrival_latest INTEGER,
  travel_trip_destination TEXT,
  travel_trip_type TEXT,
  travel_trip_inferred_at INTEGER,
  status_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_home_member_live_status_faction
  ON home_member_live_status(faction_id);

CREATE INDEX IF NOT EXISTS idx_home_member_live_status_state
  ON home_member_live_status(status_state);

CREATE INDEX IF NOT EXISTS idx_home_member_live_status_travel
  ON home_member_live_status(status_state, estimated_arrival_at);

CREATE TABLE IF NOT EXISTS enemy_member_live_status (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  is_revivable INTEGER,
  status_state TEXT,
  status_description TEXT,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  plane_image_type TEXT,
  travel_origin TEXT,
  travel_destination TEXT,
  travel_signature TEXT,
  travel_detected_at INTEGER,
  travel_started_after INTEGER,
  travel_started_before INTEGER,
  estimated_arrival_at INTEGER,
  estimated_arrival_earliest INTEGER,
  estimated_arrival_latest INTEGER,
  travel_trip_destination TEXT,
  travel_trip_type TEXT,
  travel_trip_inferred_at INTEGER,
  status_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_enemy_member_live_status_faction
  ON enemy_member_live_status(faction_id);

CREATE INDEX IF NOT EXISTS idx_enemy_member_live_status_state
  ON enemy_member_live_status(status_state);

CREATE INDEX IF NOT EXISTS idx_enemy_member_live_status_travel
  ON enemy_member_live_status(status_state, estimated_arrival_at);

INSERT OR IGNORE INTO home_member_live_status (
  member_id,
  faction_id,
  is_revivable,
  status_state,
  status_description,
  last_action_status,
  last_action_timestamp,
  plane_image_type,
  travel_origin,
  travel_destination,
  travel_signature,
  travel_detected_at,
  travel_started_after,
  travel_started_before,
  estimated_arrival_at,
  estimated_arrival_earliest,
  estimated_arrival_latest,
  travel_trip_destination,
  travel_trip_type,
  travel_trip_inferred_at,
  status_updated_at,
  updated_at
)
SELECT
  member_id,
  faction_id,
  is_revivable,
  status_state,
  status_description,
  last_action_status,
  last_action_timestamp,
  plane_image_type,
  travel_origin,
  travel_destination,
  travel_signature,
  travel_detected_at,
  travel_started_after,
  travel_started_before,
  estimated_arrival_at,
  estimated_arrival_earliest,
  estimated_arrival_latest,
  travel_trip_destination,
  travel_trip_type,
  travel_trip_inferred_at,
  status_updated_at,
  updated_at
FROM home_faction_members
WHERE is_current = 1;

INSERT OR IGNORE INTO enemy_member_live_status (
  member_id,
  faction_id,
  is_revivable,
  status_state,
  status_description,
  last_action_status,
  last_action_timestamp,
  plane_image_type,
  travel_origin,
  travel_destination,
  travel_signature,
  travel_detected_at,
  travel_started_after,
  travel_started_before,
  estimated_arrival_at,
  estimated_arrival_earliest,
  estimated_arrival_latest,
  travel_trip_destination,
  travel_trip_type,
  travel_trip_inferred_at,
  status_updated_at,
  updated_at
)
SELECT
  member_id,
  faction_id,
  is_revivable,
  status_state,
  status_description,
  last_action_status,
  last_action_timestamp,
  plane_image_type,
  travel_origin,
  travel_destination,
  travel_signature,
  travel_detected_at,
  travel_started_after,
  travel_started_before,
  estimated_arrival_at,
  estimated_arrival_earliest,
  estimated_arrival_latest,
  travel_trip_destination,
  travel_trip_type,
  travel_trip_inferred_at,
  status_updated_at,
  updated_at
FROM enemy_faction_members;
