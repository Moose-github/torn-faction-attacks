CREATE TABLE IF NOT EXISTS trade_watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  item_ids_json TEXT NOT NULL,
  item_source TEXT NOT NULL DEFAULT 'weav3r_verified',
  min_profit INTEGER NOT NULL DEFAULT 25000,
  min_roi_percent REAL NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 1,
  market_fee_percent REAL NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS trade_watchlist_snapshots (
  id TEXT PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES trade_watchlists(id) ON DELETE CASCADE,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  settings_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_opportunities (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES trade_watchlist_snapshots(id) ON DELETE CASCADE,
  watchlist_id INTEGER NOT NULL REFERENCES trade_watchlists(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  source TEXT NOT NULL,
  listing_price INTEGER NOT NULL,
  resale_price INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  roi_percent REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  bulk_profit INTEGER NOT NULL DEFAULT 0,
  needed_quantity INTEGER,
  seller_id INTEGER,
  seller_name TEXT,
  reference_label TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_trade_watchlists_updated_at
  ON trade_watchlists(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_snapshots_watchlist_scanned
  ON trade_watchlist_snapshots(watchlist_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_opportunities_snapshot_profit
  ON trade_opportunities(snapshot_id, profit DESC);

CREATE INDEX IF NOT EXISTS idx_trade_opportunities_watchlist_created
  ON trade_opportunities(watchlist_id, created_at DESC);
