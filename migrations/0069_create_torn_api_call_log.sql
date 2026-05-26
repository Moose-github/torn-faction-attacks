CREATE TABLE IF NOT EXISTS torn_api_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_at INTEGER NOT NULL,
  feature TEXT NOT NULL,
  key_source TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  retry_attempt INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_torn_api_call_log_requested_at
  ON torn_api_call_log(requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_torn_api_call_log_feature_requested_at
  ON torn_api_call_log(feature, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_torn_api_call_log_status_requested_at
  ON torn_api_call_log(status, requested_at DESC);
