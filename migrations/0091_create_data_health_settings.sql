CREATE TABLE IF NOT EXISTS data_health_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ingestion_warn_seconds INTEGER NOT NULL DEFAULT 600,
  ingestion_critical_seconds INTEGER NOT NULL DEFAULT 1800,
  maintenance_warn_seconds INTEGER NOT NULL DEFAULT 2700,
  maintenance_critical_seconds INTEGER NOT NULL DEFAULT 7200,
  daily_stats_lag_warn_days INTEGER NOT NULL DEFAULT 1,
  daily_stats_lag_critical_days INTEGER NOT NULL DEFAULT 2,
  stale_daily_members_warn INTEGER NOT NULL DEFAULT 1,
  stale_daily_members_critical INTEGER NOT NULL DEFAULT 5,
  api_error_rate_warn_percent REAL NOT NULL DEFAULT 5,
  api_error_rate_critical_percent REAL NOT NULL DEFAULT 15,
  api_rate_limited_warn INTEGER NOT NULL DEFAULT 1,
  api_rate_limited_critical INTEGER NOT NULL DEFAULT 5,
  stock_freshness_warn_seconds INTEGER NOT NULL DEFAULT 300,
  stock_freshness_critical_seconds INTEGER NOT NULL DEFAULT 1800,
  stale_stocks_warn INTEGER NOT NULL DEFAULT 1,
  stale_stocks_critical INTEGER NOT NULL DEFAULT 5,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO data_health_settings (id)
VALUES (1)
ON CONFLICT(id) DO NOTHING;
