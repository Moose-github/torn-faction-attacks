CREATE TABLE member_personal_stats_recent (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  daysbeendonator INTEGER,
  xantaken_timestamp INTEGER,
  overdosed_timestamp INTEGER,
  refills_timestamp INTEGER,
  useractivity_timestamp INTEGER,
  networth_timestamp INTEGER,
  daysbeendonator_timestamp INTEGER,
  personalstats_bucket_date TEXT,
  requested_at INTEGER NOT NULL,
  attempted_at INTEGER,
  personalstats_key_source TEXT,
  personal_captured_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'retry_expired', 'failed')),
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE INDEX idx_member_personal_stats_recent_status
  ON member_personal_stats_recent(status, snapshot_date, attempted_at, member_name);

CREATE INDEX idx_member_personal_stats_recent_captured
  ON member_personal_stats_recent(snapshot_date, personal_captured_at);
