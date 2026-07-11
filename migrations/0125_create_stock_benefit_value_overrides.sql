CREATE TABLE IF NOT EXISTS stock_benefit_value_overrides (
  torn_user_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  override_value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, benefit_key)
);
