-- Durable recovery and collection health. Existing snapshots stay unchanged.
ALTER TABLE ranked_research_runs ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_research_runs ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_research_runs ADD COLUMN last_success_at INTEGER;
ALTER TABLE ranked_research_runs ADD COLUMN last_saved_at INTEGER;
ALTER TABLE ranked_research_runs ADD COLUMN last_tick_at INTEGER;
ALTER TABLE ranked_research_runs ADD COLUMN last_error TEXT;
ALTER TABLE ranked_research_run_wars ADD COLUMN reused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranked_research_attempts ADD COLUMN war_id INTEGER;
ALTER TABLE ranked_research_attempts ADD COLUMN outcome TEXT;
CREATE INDEX IF NOT EXISTS idx_ranked_research_attempt_run ON ranked_research_attempts(run_id, attempted_at);
CREATE TABLE IF NOT EXISTS ranked_research_key_cooldowns (
  key_id TEXT PRIMARY KEY REFERENCES torn_api_keys(id),
  until_ts INTEGER NOT NULL,
  last_error TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ranked_research_report_retries (
  run_id TEXT NOT NULL REFERENCES ranked_research_runs(id),
  war_id INTEGER NOT NULL REFERENCES ranked_research_reports(war_id),
  failures INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL,
  unresolved_at_freeze INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, war_id)
);
