CREATE TABLE IF NOT EXISTS torn_api_keys (
  id TEXT PRIMARY KEY,
  label TEXT,
  encrypted_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL UNIQUE,
  submitted_by_torn_user_id INTEGER,
  owner_torn_user_id INTEGER,
  owner_name TEXT,
  access_level INTEGER,
  access_type TEXT,
  faction_access INTEGER,
  status TEXT NOT NULL,
  allowed_features_json TEXT NOT NULL,
  max_requests_per_minute INTEGER,
  last_validated_at INTEGER,
  last_used_at INTEGER,
  last_used_feature TEXT,
  monitor_last_used_at INTEGER,
  paused_until INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS torn_api_key_usage_windows (
  key_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (key_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_torn_api_keys_submitter
  ON torn_api_keys(submitted_by_torn_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_torn_api_keys_status
  ON torn_api_keys(status, paused_until, last_used_at);

CREATE INDEX IF NOT EXISTS idx_torn_api_key_usage_windows_window
  ON torn_api_key_usage_windows(window_start DESC);
