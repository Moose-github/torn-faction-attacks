CREATE TABLE IF NOT EXISTS stock_profiles (
  stock_id INTEGER PRIMARY KEY,
  acronym TEXT,
  name TEXT,
  current_price REAL,
  market_cap INTEGER,
  total_shares INTEGER,
  available_shares INTEGER,
  forecast TEXT,
  demand TEXT,
  benefit_json TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_price_snapshots (
  stock_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  price REAL NOT NULL,
  raw_json TEXT,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (stock_id, observed_at),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE TABLE IF NOT EXISTS stock_ingestion_runs (
  id TEXT PRIMARY KEY,
  batch_group TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  stocks_attempted INTEGER NOT NULL DEFAULT 0,
  stocks_succeeded INTEGER NOT NULL DEFAULT 0,
  stocks_failed INTEGER NOT NULL DEFAULT 0,
  points_seen INTEGER NOT NULL DEFAULT 0,
  points_written INTEGER NOT NULL DEFAULT 0,
  recoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  unrecoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_profiles_updated
  ON stock_profiles(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_price_snapshots_observed
  ON stock_price_snapshots(observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_price_snapshots_stock_observed
  ON stock_price_snapshots(stock_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_ingestion_runs_started
  ON stock_ingestion_runs(started_at DESC);
