CREATE TABLE IF NOT EXISTS stock_price_rollups_hourly (
  stock_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  open_price REAL NOT NULL,
  high_price REAL NOT NULL,
  low_price REAL NOT NULL,
  close_price REAL NOT NULL,
  avg_price REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (stock_id, bucket_start),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_price_rollups_hourly_bucket_stock
  ON stock_price_rollups_hourly(bucket_start ASC, stock_id ASC);

CREATE TABLE IF NOT EXISTS stock_price_rollups_daily (
  stock_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  open_price REAL NOT NULL,
  high_price REAL NOT NULL,
  low_price REAL NOT NULL,
  close_price REAL NOT NULL,
  avg_price REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  first_observed_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (stock_id, bucket_start),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_price_rollups_daily_bucket_stock
  ON stock_price_rollups_daily(bucket_start ASC, stock_id ASC);

CREATE TABLE IF NOT EXISTS stock_ingestion_run_daily_stats (
  bucket_start INTEGER PRIMARY KEY,
  total_runs INTEGER NOT NULL DEFAULT 0,
  ok_runs INTEGER NOT NULL DEFAULT 0,
  partial_runs INTEGER NOT NULL DEFAULT 0,
  error_runs INTEGER NOT NULL DEFAULT 0,
  running_runs INTEGER NOT NULL DEFAULT 0,
  stocks_attempted INTEGER NOT NULL DEFAULT 0,
  stocks_succeeded INTEGER NOT NULL DEFAULT 0,
  stocks_failed INTEGER NOT NULL DEFAULT 0,
  points_seen INTEGER NOT NULL DEFAULT 0,
  points_written INTEGER NOT NULL DEFAULT 0,
  recoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  unrecoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  first_started_at INTEGER,
  last_started_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
