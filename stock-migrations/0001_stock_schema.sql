-- Dedicated stock database. Core API keys, logs and sync_state stay in DB.
CREATE TABLE IF NOT EXISTS stock_benefit_disabled_stocks (
  torn_user_id INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, stock_id)
);

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

CREATE TABLE IF NOT EXISTS stock_benefit_value_overrides (
  torn_user_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  override_value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, benefit_key)
);

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

CREATE TABLE IF NOT EXISTS stock_paper_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'active',
  strategy_key TEXT NOT NULL,
  starting_cash REAL NOT NULL,
  cash_balance REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  buy_fee_rate REAL NOT NULL DEFAULT 0,
  sell_fee_rate REAL NOT NULL DEFAULT 0.001,
  max_open_positions INTEGER NOT NULL DEFAULT 5,
  max_position_fraction REAL NOT NULL DEFAULT 0.25,
  min_cash_reserve_fraction REAL NOT NULL DEFAULT 0.05,
  last_decision_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_paper_equity_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  simulation_run_id TEXT,
  observed_at INTEGER NOT NULL,
  cash_balance REAL NOT NULL,
  holdings_value REAL NOT NULL,
  total_equity REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  exposure_fraction REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (simulation_run_id) REFERENCES stock_paper_simulation_runs(id)
);

CREATE TABLE IF NOT EXISTS stock_paper_positions (
  account_id TEXT NOT NULL,
  stock_id INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  average_entry_price REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, stock_id),
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE TABLE IF NOT EXISTS stock_paper_simulation_runs (
  id TEXT PRIMARY KEY,
  strategy_key TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  simulation_start_at INTEGER,
  simulation_end_at INTEGER,
  status TEXT NOT NULL,
  starting_cash REAL NOT NULL,
  final_equity REAL,
  return_percent REAL,
  max_drawdown_percent REAL,
  trade_count INTEGER NOT NULL DEFAULT 0,
  win_trade_count INTEGER NOT NULL DEFAULT 0,
  buy_fee_rate REAL NOT NULL DEFAULT 0,
  sell_fee_rate REAL NOT NULL DEFAULT 0.001,
  config_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS stock_paper_trades (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  simulation_run_id TEXT,
  stock_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  shares INTEGER NOT NULL,
  price REAL NOT NULL,
  gross_value REAL NOT NULL,
  fee REAL NOT NULL,
  net_value REAL NOT NULL,
  realized_pnl REAL,
  executed_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  score REAL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (simulation_run_id) REFERENCES stock_paper_simulation_runs(id),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

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

CREATE TABLE IF NOT EXISTS stock_price_snapshots (
  stock_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  price REAL NOT NULL,
  raw_json TEXT,
  fetched_at INTEGER NOT NULL, market_cap INTEGER, total_shares INTEGER, investors INTEGER,
  PRIMARY KEY (stock_id, observed_at),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

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
, benefit_key TEXT, benefit_label TEXT, benefit_market_type TEXT, benefit_torn_item_id INTEGER, benefit_quantity REAL);

CREATE INDEX IF NOT EXISTS idx_stock_ingestion_runs_started
  ON stock_ingestion_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_accounts_mode_status
  ON stock_paper_accounts(mode, status);

CREATE INDEX IF NOT EXISTS idx_stock_paper_equity_account_time
  ON stock_paper_equity_snapshots(account_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_equity_simulation_time
  ON stock_paper_equity_snapshots(simulation_run_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_simulation_runs_started
  ON stock_paper_simulation_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_trades_account_time
  ON stock_paper_trades(account_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_trades_simulation_time
  ON stock_paper_trades(simulation_run_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_price_rollups_daily_bucket_stock
  ON stock_price_rollups_daily(bucket_start ASC, stock_id ASC);

CREATE INDEX IF NOT EXISTS idx_stock_price_rollups_hourly_bucket_stock
  ON stock_price_rollups_hourly(bucket_start ASC, stock_id ASC);

CREATE INDEX IF NOT EXISTS idx_stock_price_snapshots_observed_stock
  ON stock_price_snapshots(observed_at ASC, stock_id ASC);

CREATE INDEX IF NOT EXISTS idx_stock_profiles_benefit_key
  ON stock_profiles(benefit_key);

CREATE INDEX IF NOT EXISTS idx_stock_profiles_updated
  ON stock_profiles(updated_at DESC);
