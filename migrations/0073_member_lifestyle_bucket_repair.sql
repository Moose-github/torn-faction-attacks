ALTER TABLE member_lifestyle_stats ADD COLUMN xantaken_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN overdosed_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN refills_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN useractivity_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN networth_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN daysbeendonator_timestamp INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN personalstats_bucket_date TEXT;
ALTER TABLE member_lifestyle_stats ADD COLUMN personalstats_requested_at INTEGER;
ALTER TABLE member_lifestyle_stats ADD COLUMN personalstats_key_source TEXT;

ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN xantaken_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN overdosed_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN refills_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN useractivity_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN networth_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN daysbeendonator_timestamp INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN personalstats_bucket_date TEXT;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN personalstats_requested_at INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN personalstats_key_source TEXT;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN validation_error TEXT;

CREATE TABLE IF NOT EXISTS member_lifestyle_repair_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  effective_start_date TEXT NOT NULL,
  member_scope TEXT NOT NULL DEFAULT 'current',
  calls_per_minute_per_key INTEGER NOT NULL DEFAULT 35,
  include_primary_key INTEGER NOT NULL DEFAULT 1,
  active_key_count INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  alert_sent_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS member_lifestyle_repair_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  snapshot_date TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  key_source TEXT,
  returned_bucket_date TEXT,
  error TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(job_id, member_id, snapshot_date),
  FOREIGN KEY (job_id) REFERENCES member_lifestyle_repair_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_stats_bucket_date
  ON member_lifestyle_stats(personalstats_bucket_date);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_snapshots_bucket_date
  ON member_lifestyle_stat_snapshots(personalstats_bucket_date);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_repair_jobs_status
  ON member_lifestyle_repair_jobs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_repair_items_job_status
  ON member_lifestyle_repair_items(job_id, status, snapshot_date, member_id);

CREATE INDEX IF NOT EXISTS idx_member_lifestyle_repair_items_status
  ON member_lifestyle_repair_items(status, updated_at);
