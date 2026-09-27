-- Medical quantities and current borrowers use the existing source_json snapshot.
-- Expand the state category constraint without adding a permanent table.
CREATE TABLE faction_armory_state_medical (
  faction_id INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'weapons' CHECK (category IN ('weapons', 'armor', 'medical')),
  inventory_timestamp INTEGER,
  checked_at INTEGER,
  next_inventory_at INTEGER NOT NULL DEFAULT 0,
  inventory_failures INTEGER NOT NULL DEFAULT 0,
  inventory_error TEXT,
  details_blocked_until INTEGER NOT NULL DEFAULT 0,
  details_error TEXT,
  details_refresh_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  source_json TEXT,
  PRIMARY KEY (faction_id, category)
);
INSERT INTO faction_armory_state_medical SELECT * FROM faction_armory_state;
DROP TABLE faction_armory_state;
ALTER TABLE faction_armory_state_medical RENAME TO faction_armory_state;
