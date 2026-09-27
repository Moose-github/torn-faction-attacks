-- Preserve the weapons snapshot, refresh state and current loan observations.
CREATE TABLE faction_armory_state_categories (
  faction_id INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'weapons' CHECK (category IN ('weapons', 'armor')),
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
INSERT INTO faction_armory_state_categories
  SELECT faction_id, 'weapons', inventory_timestamp, checked_at, next_inventory_at,
    inventory_failures, inventory_error, details_blocked_until, details_error,
    details_refresh_at, lease_token, lease_until, source_json FROM faction_armory_state;
DROP TABLE faction_armory_state;
ALTER TABLE faction_armory_state_categories RENAME TO faction_armory_state;
ALTER TABLE faction_armory_inventory ADD COLUMN category TEXT NOT NULL DEFAULT 'weapons' CHECK (category IN ('weapons', 'armor'));
CREATE INDEX idx_faction_armory_inventory_category ON faction_armory_inventory(faction_id, category);
