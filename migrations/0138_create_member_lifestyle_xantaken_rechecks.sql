CREATE TABLE IF NOT EXISTS member_lifestyle_xantaken_rechecks (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  prior_xantaken INTEGER,
  current_xantaken INTEGER,
  next_xantaken INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_check_at INTEGER NOT NULL,
  returned_bucket_date TEXT,
  returned_xantaken INTEGER,
  key_source TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_xantaken_rechecks_status
  ON member_lifestyle_xantaken_rechecks(status, next_check_at);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_xantaken_rechecks_member_date
  ON member_lifestyle_xantaken_rechecks(member_id, snapshot_date);
