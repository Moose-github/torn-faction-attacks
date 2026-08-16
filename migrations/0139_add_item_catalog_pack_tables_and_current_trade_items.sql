CREATE TABLE IF NOT EXISTS torn_items (
  torn_item_id INTEGER PRIMARY KEY,
  name TEXT,
  image_url TEXT,
  image_url_large TEXT,
  category TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS item_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS item_group_items (
  group_id TEXT NOT NULL REFERENCES item_groups(id) ON DELETE CASCADE,
  torn_item_id INTEGER NOT NULL REFERENCES torn_items(torn_item_id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (group_id, torn_item_id)
);

CREATE TABLE IF NOT EXISTS pack_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS pack_reward_entries (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES pack_definitions(id) ON DELETE CASCADE,
  torn_item_id INTEGER NOT NULL REFERENCES torn_items(torn_item_id),
  rarity TEXT NOT NULL CHECK (rarity IN ('standard', 'select', 'elite', 'legendary')),
  weight INTEGER NOT NULL CHECK (weight >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(pack_id, torn_item_id)
);

CREATE TABLE IF NOT EXISTS trade_watchlist_items (
  watchlist_id INTEGER NOT NULL REFERENCES trade_watchlists(id) ON DELETE CASCADE,
  torn_item_id INTEGER NOT NULL REFERENCES torn_items(torn_item_id),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (watchlist_id, torn_item_id)
);

CREATE TABLE IF NOT EXISTS trade_item_market_state (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES torn_items(torn_item_id),
  item_source TEXT NOT NULL,
  item_name TEXT,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  raw_json TEXT,
  UNIQUE(item_id, item_source)
);

CREATE TABLE IF NOT EXISTS trade_item_current_offers (
  id TEXT PRIMARY KEY,
  market_state_id TEXT NOT NULL REFERENCES trade_item_market_state(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  item_source TEXT NOT NULL,
  source TEXT NOT NULL,
  listing_price INTEGER NOT NULL,
  reference_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fee_applies INTEGER NOT NULL DEFAULT 1,
  seller_id INTEGER,
  seller_name TEXT,
  reference_label TEXT,
  raw_json TEXT,
  fetched_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO torn_items (
  torn_item_id,
  name,
  image_url,
  image_url_large,
  updated_at
)
VALUES
  (530, 'Torn item 530', 'https://www.torn.com/images/items/530/medium@2x.png', 'https://www.torn.com/images/items/530/large@2x.png', unixepoch()),
  (532, 'Torn item 532', 'https://www.torn.com/images/items/532/medium@2x.png', 'https://www.torn.com/images/items/532/large@2x.png', unixepoch()),
  (533, 'Torn item 533', 'https://www.torn.com/images/items/533/medium@2x.png', 'https://www.torn.com/images/items/533/large@2x.png', unixepoch()),
  (553, 'Torn item 553', 'https://www.torn.com/images/items/553/medium@2x.png', 'https://www.torn.com/images/items/553/large@2x.png', unixepoch()),
  (554, 'Torn item 554', 'https://www.torn.com/images/items/554/medium@2x.png', 'https://www.torn.com/images/items/554/large@2x.png', unixepoch()),
  (555, 'Torn item 555', 'https://www.torn.com/images/items/555/medium@2x.png', 'https://www.torn.com/images/items/555/large@2x.png', unixepoch()),
  (985, 'Torn item 985', 'https://www.torn.com/images/items/985/medium@2x.png', 'https://www.torn.com/images/items/985/large@2x.png', unixepoch()),
  (986, 'Torn item 986', 'https://www.torn.com/images/items/986/medium@2x.png', 'https://www.torn.com/images/items/986/large@2x.png', unixepoch()),
  (987, 'Torn item 987', 'https://www.torn.com/images/items/987/medium@2x.png', 'https://www.torn.com/images/items/987/large@2x.png', unixepoch());

INSERT OR IGNORE INTO item_groups (
  id,
  name,
  description
)
VALUES (
  'energy_cans',
  'Energy cans',
  'Energy can items used by Trade Scout presets and pack rewards.'
);

INSERT OR IGNORE INTO item_group_items (
  group_id,
  torn_item_id,
  display_order
)
VALUES
  ('energy_cans', 530, 0),
  ('energy_cans', 532, 1),
  ('energy_cans', 533, 2),
  ('energy_cans', 553, 3),
  ('energy_cans', 554, 4),
  ('energy_cans', 555, 5),
  ('energy_cans', 985, 6),
  ('energy_cans', 986, 7),
  ('energy_cans', 987, 8);

INSERT OR IGNORE INTO pack_definitions (
  id,
  name,
  description
)
VALUES (
  'faction_energy_pack',
  'Faction energy pack',
  'Rainbow Six Siege-style reveal pack using the initial energy can reward pool.'
);

INSERT OR IGNORE INTO pack_reward_entries (
  id,
  pack_id,
  torn_item_id,
  rarity,
  weight,
  display_order
)
VALUES
  ('faction_energy_pack:530', 'faction_energy_pack', 530, 'standard', 24, 0),
  ('faction_energy_pack:532', 'faction_energy_pack', 532, 'standard', 22, 1),
  ('faction_energy_pack:533', 'faction_energy_pack', 533, 'select', 16, 2),
  ('faction_energy_pack:553', 'faction_energy_pack', 553, 'select', 14, 3),
  ('faction_energy_pack:554', 'faction_energy_pack', 554, 'elite', 10, 4),
  ('faction_energy_pack:555', 'faction_energy_pack', 555, 'elite', 8, 5),
  ('faction_energy_pack:985', 'faction_energy_pack', 985, 'legendary', 3, 6),
  ('faction_energy_pack:986', 'faction_energy_pack', 986, 'legendary', 2, 7),
  ('faction_energy_pack:987', 'faction_energy_pack', 987, 'legendary', 1, 8);

INSERT OR IGNORE INTO torn_items (
  torn_item_id,
  name,
  image_url,
  image_url_large,
  updated_at
)
SELECT DISTINCT
  item_id,
  item_name,
  'https://www.torn.com/images/items/' || item_id || '/medium@2x.png',
  'https://www.torn.com/images/items/' || item_id || '/large@2x.png',
  COALESCE(scanned_at, unixepoch())
FROM trade_item_snapshots
WHERE item_id IS NOT NULL;

INSERT OR IGNORE INTO torn_items (
  torn_item_id,
  image_url,
  image_url_large,
  updated_at
)
SELECT DISTINCT
  CAST(json_each.value AS INTEGER),
  'https://www.torn.com/images/items/' || CAST(json_each.value AS INTEGER) || '/medium@2x.png',
  'https://www.torn.com/images/items/' || CAST(json_each.value AS INTEGER) || '/large@2x.png',
  unixepoch()
FROM trade_watchlists,
  json_each(trade_watchlists.item_ids_json)
WHERE CAST(json_each.value AS INTEGER) > 0;

INSERT OR IGNORE INTO trade_watchlist_items (
  watchlist_id,
  torn_item_id,
  display_order,
  created_at
)
SELECT
  trade_watchlists.id,
  CAST(json_each.value AS INTEGER),
  CAST(json_each.key AS INTEGER),
  trade_watchlists.created_at
FROM trade_watchlists,
  json_each(trade_watchlists.item_ids_json)
WHERE CAST(json_each.value AS INTEGER) > 0;

INSERT OR REPLACE INTO trade_item_market_state (
  id,
  item_id,
  item_source,
  item_name,
  scanned_by_torn_user_id,
  scanned_at,
  status,
  error,
  raw_json
)
SELECT
  latest.item_source || ':' || latest.item_id,
  latest.item_id,
  latest.item_source,
  latest.item_name,
  latest.scanned_by_torn_user_id,
  latest.scanned_at,
  latest.status,
  latest.error,
  latest.raw_json
FROM trade_item_snapshots latest
WHERE latest.id = (
  SELECT candidate.id
  FROM trade_item_snapshots candidate
  WHERE candidate.item_id = latest.item_id
    AND candidate.item_source = latest.item_source
  ORDER BY candidate.scanned_at DESC, candidate.id DESC
  LIMIT 1
);

INSERT OR REPLACE INTO trade_item_current_offers (
  id,
  market_state_id,
  item_id,
  item_name,
  item_source,
  source,
  listing_price,
  reference_price,
  quantity,
  fee_applies,
  seller_id,
  seller_name,
  reference_label,
  raw_json,
  fetched_at
)
SELECT
  latest.item_source || ':' || latest.item_id || ':' || offers.id,
  latest.item_source || ':' || latest.item_id,
  offers.item_id,
  offers.item_name,
  offers.item_source,
  offers.source,
  offers.listing_price,
  offers.reference_price,
  offers.quantity,
  offers.fee_applies,
  offers.seller_id,
  offers.seller_name,
  offers.reference_label,
  offers.raw_json,
  offers.created_at
FROM trade_item_snapshots latest
JOIN trade_item_offers offers
  ON offers.item_snapshot_id = latest.id
WHERE latest.id = (
  SELECT candidate.id
  FROM trade_item_snapshots candidate
  WHERE candidate.item_id = latest.item_id
    AND candidate.item_source = latest.item_source
  ORDER BY candidate.scanned_at DESC, candidate.id DESC
  LIMIT 1
);

DROP TABLE IF EXISTS trade_item_offers;
DROP TABLE IF EXISTS trade_item_snapshots;

CREATE INDEX IF NOT EXISTS idx_torn_items_name
  ON torn_items(name);

CREATE INDEX IF NOT EXISTS idx_item_group_items_item
  ON item_group_items(torn_item_id);

CREATE INDEX IF NOT EXISTS idx_pack_reward_entries_pack
  ON pack_reward_entries(pack_id, enabled, display_order);

CREATE INDEX IF NOT EXISTS idx_pack_reward_entries_item
  ON pack_reward_entries(torn_item_id);

CREATE INDEX IF NOT EXISTS idx_trade_watchlist_items_item
  ON trade_watchlist_items(torn_item_id);

CREATE INDEX IF NOT EXISTS idx_trade_item_market_state_scanned
  ON trade_item_market_state(item_source, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_item_current_offers_item
  ON trade_item_current_offers(item_id, item_source, listing_price);

CREATE INDEX IF NOT EXISTS idx_trade_item_current_offers_state
  ON trade_item_current_offers(market_state_id);
