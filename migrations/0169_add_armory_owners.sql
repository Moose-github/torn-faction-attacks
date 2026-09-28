-- Current ownership assignments survive inventory refreshes and temporary removal.
ALTER TABLE faction_armory_state ADD COLUMN owners_json TEXT NOT NULL DEFAULT '{}';
