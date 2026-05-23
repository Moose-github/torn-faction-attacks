CREATE TABLE IF NOT EXISTS member_achievement_summaries (
  metric_key TEXT NOT NULL,
  metric_group TEXT NOT NULL,
  metric_title TEXT NOT NULL,
  period_key TEXT NOT NULL,
  rank INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  source_snapshot_date TEXT,
  detail_json TEXT,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (metric_key, rank)
);

CREATE INDEX IF NOT EXISTS idx_member_achievement_group
  ON member_achievement_summaries(metric_group, metric_key, rank);

CREATE INDEX IF NOT EXISTS idx_member_achievement_computed
  ON member_achievement_summaries(computed_at DESC);
