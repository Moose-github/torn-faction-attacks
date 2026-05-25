CREATE TABLE IF NOT EXISTS trade_item_snapshots (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  item_source TEXT NOT NULL,
  item_name TEXT,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS trade_item_offers (
  id TEXT PRIMARY KEY,
  item_snapshot_id TEXT NOT NULL REFERENCES trade_item_snapshots(id) ON DELETE CASCADE,
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
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_trade_item_snapshots_latest
  ON trade_item_snapshots(item_id, item_source, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_item_offers_snapshot
  ON trade_item_offers(item_snapshot_id);
