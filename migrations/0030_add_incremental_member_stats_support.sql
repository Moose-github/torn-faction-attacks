ALTER TABLE war_member_stats
  ADD COLUMN enemy_respect_gained_raw REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_attacks_war_ingest_run
  ON attacks(war_id, ingest_run_id);
