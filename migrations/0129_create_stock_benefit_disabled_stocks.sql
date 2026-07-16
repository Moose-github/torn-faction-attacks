CREATE TABLE IF NOT EXISTS stock_benefit_disabled_stocks (
  torn_user_id INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, stock_id)
);
