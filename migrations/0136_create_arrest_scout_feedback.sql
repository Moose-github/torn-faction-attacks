CREATE TABLE IF NOT EXISTS arrest_scout_feedback (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES arrest_scout_results(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL REFERENCES arrest_scout_snapshots(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'fail')),
  profit INTEGER CHECK (profit IS NULL OR profit >= 0),
  submitted_by_torn_user_id INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_feedback_result
  ON arrest_scout_feedback(result_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_feedback_created
  ON arrest_scout_feedback(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_arrest_scout_feedback_target
  ON arrest_scout_feedback(target_user_id, created_at DESC);
