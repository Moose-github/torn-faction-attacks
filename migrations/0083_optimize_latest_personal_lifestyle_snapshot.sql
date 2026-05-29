CREATE INDEX IF NOT EXISTS idx_member_lifestyle_snapshots_personal_ready_latest
  ON member_lifestyle_stat_snapshots(personal_ready, snapshot_date DESC, member_id);
