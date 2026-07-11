CREATE TABLE IF NOT EXISTS stock_benefit_item_prices (
  benefit_key TEXT PRIMARY KEY,
  market_type TEXT NOT NULL DEFAULT 'itemmarket',
  torn_item_id INTEGER,
  item_name TEXT,
  market_value REAL,
  fetched_at INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
