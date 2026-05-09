ALTER TABLE wars ADD COLUMN enemy_scouting_status_checked_at INTEGER;

ALTER TABLE enemy_faction_members ADD COLUMN status_state TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN status_description TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN plane_image_type TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN travel_origin TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN travel_destination TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN travel_signature TEXT;
ALTER TABLE enemy_faction_members ADD COLUMN travel_detected_at INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN travel_started_after INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN travel_started_before INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN estimated_arrival_at INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN estimated_arrival_earliest INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN estimated_arrival_latest INTEGER;
ALTER TABLE enemy_faction_members ADD COLUMN status_updated_at INTEGER;
