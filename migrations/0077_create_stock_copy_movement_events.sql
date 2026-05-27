CREATE TABLE IF NOT EXISTS stock_copy_movement_events (
  id TEXT PRIMARY KEY,
  source_player_id INTEGER NOT NULL,
  source_player_name TEXT NOT NULL,
  activity_status TEXT,
  activity_timestamp INTEGER,
  observed_at INTEGER NOT NULL,
  window_start_at INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  strength REAL NOT NULL,
  price_change REAL,
  investor_change REAL,
  share_pressure REAL,
  market_cap_change REAL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  paper_trade_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(source_player_id, observed_at, stock_id, side),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id),
  FOREIGN KEY (paper_trade_id) REFERENCES stock_paper_trades(id)
);

CREATE INDEX IF NOT EXISTS idx_stock_copy_movement_events_source_time
  ON stock_copy_movement_events(source_player_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_copy_movement_events_status_time
  ON stock_copy_movement_events(status, observed_at DESC);
