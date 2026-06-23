ALTER TABLE home_faction_members
  ADD COLUMN status_state TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN status_description TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN last_action_status TEXT;

ALTER TABLE home_faction_members
  ADD COLUMN last_action_timestamp INTEGER;

ALTER TABLE home_faction_members
  ADD COLUMN status_updated_at INTEGER;
