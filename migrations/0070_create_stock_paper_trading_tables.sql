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

CREATE INDEX IF NOT EXISTS idx_stock_paper_accounts_mode_status
  ON stock_paper_accounts(mode, status);

CREATE INDEX IF NOT EXISTS idx_stock_paper_trades_account_time
  ON stock_paper_trades(account_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_trades_simulation_time
  ON stock_paper_trades(simulation_run_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_equity_account_time
  ON stock_paper_equity_snapshots(account_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_equity_simulation_time
  ON stock_paper_equity_snapshots(simulation_run_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_paper_simulation_runs_started
  ON stock_paper_simulation_runs(started_at DESC);
