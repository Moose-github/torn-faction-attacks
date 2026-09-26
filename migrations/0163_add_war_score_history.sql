CREATE TABLE war_score_state (
  war_id INTEGER PRIMARY KEY REFERENCES wars(id) ON DELETE CASCADE,
  observed_at INTEGER NOT NULL,
  official_start_time INTEGER NOT NULL,
  ended_at INTEGER,
  home_name TEXT NOT NULL,
  enemy_name TEXT NOT NULL,
  home_score REAL NOT NULL,
  enemy_score REAL NOT NULL,
  target REAL NOT NULL,
  original_target REAL
);

CREATE TABLE war_score_history (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  bucket_start INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  home_score REAL NOT NULL,
  enemy_score REAL NOT NULL,
  target REAL NOT NULL,
  PRIMARY KEY (war_id, bucket_start)
);
