CREATE TABLE torn_api_usage_rollup_15m (
  bucket_start INTEGER NOT NULL,
  group_type TEXT NOT NULL CHECK (group_type IN ('feature', 'endpoint', 'key_source')),
  group_value TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  max_duration_ms INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bucket_start, group_type, group_value)
);

CREATE INDEX idx_torn_api_usage_rollup_type_bucket
  ON torn_api_usage_rollup_15m(group_type, bucket_start DESC);
