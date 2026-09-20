CREATE TABLE daily_stats_issue_acceptances (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  issue_status TEXT NOT NULL,
  issue_error TEXT,
  accepted_by INTEGER,
  accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (member_id, snapshot_date)
);
