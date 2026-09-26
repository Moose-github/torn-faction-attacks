CREATE TABLE faction_armory_state (
  faction_id INTEGER PRIMARY KEY,
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
  source_json TEXT
);
CREATE TABLE faction_armory_inventory (
  faction_id INTEGER NOT NULL,
  uid TEXT NOT NULL,
  model_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slot_type TEXT NOT NULL,
  borrower_id INTEGER,
  borrower_name TEXT,
  PRIMARY KEY (faction_id, uid)
);
CREATE TABLE armory_weapon_details (
  uid TEXT PRIMARY KEY,
  model_id INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  payload_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE armory_detail_fetch_state (
  uid TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  refetch INTEGER NOT NULL DEFAULT 0
);
