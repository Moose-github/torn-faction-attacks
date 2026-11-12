-- Keep published stats stable until the manual scan has completed.
CREATE TABLE recruitment_scan_stats (
  run_id TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  total_work_stats INTEGER NOT NULL,
  hof_position INTEGER NOT NULL,
  work_stats_checked_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, player_id)
);
INSERT INTO recruitment_scan_stats
SELECT s.run_id, w.* FROM recruitment_work_stats w, recruitment_scan s
WHERE s.status IN ('running','paused','failed') AND w.work_stats_checked_at >= s.started_at;
ALTER TABLE recruitment_scan ADD COLUMN results_pending INTEGER NOT NULL DEFAULT 0;

CREATE TABLE recruitment_result_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  stats_version TEXT NOT NULL DEFAULT 'initial',
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO recruitment_result_state(id) VALUES(1);
CREATE TABLE recruitment_results (
  version INTEGER PRIMARY KEY,
  snapshot_id TEXT,
  stats_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  built_at INTEGER NOT NULL
);
-- Small JSON chunks avoid D1's per-row size limit for the full candidate list.
CREATE TABLE recruitment_result_chunks (
  version INTEGER NOT NULL REFERENCES recruitment_results(version) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(version, chunk_id)
);
-- Bootstrap existing data once on the next scheduler tick, never on page reads.
UPDATE recruitment_scan SET results_pending = 1;
