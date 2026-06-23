CREATE TABLE IF NOT EXISTS war_control_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  control_hospital_threshold REAL NOT NULL DEFAULT 0.8,
  available_advantage_min REAL NOT NULL DEFAULT 0.15,
  opening_grace_minutes INTEGER NOT NULL DEFAULT 15,
  status_freshness_max_seconds INTEGER NOT NULL DEFAULT 180,
  min_observed_roster_percent REAL NOT NULL DEFAULT 0.6,
  min_local_relevant_members INTEGER NOT NULL DEFAULT 10,
  heavy_own_hospital_penalty_threshold REAL NOT NULL DEFAULT 0.6,
  severe_own_hospital_penalty_threshold REAL NOT NULL DEFAULT 0.75,
  heavy_own_hospital_confidence_penalty REAL NOT NULL DEFAULT 0.1,
  severe_own_hospital_confidence_penalty REAL NOT NULL DEFAULT 0.2,
  transition_hospital_ratio_drop REAL NOT NULL DEFAULT 0.2,
  transition_window_minutes INTEGER NOT NULL DEFAULT 5,
  transition_min_attacks_5m INTEGER NOT NULL DEFAULT 3,
  transition_big_hitter_multiplier_one REAL NOT NULL DEFAULT 1.1,
  transition_big_hitter_multiplier_multiple REAL NOT NULL DEFAULT 1.25,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO war_control_settings (id)
VALUES (1);

CREATE TABLE IF NOT EXISTS war_control_snapshots (
  war_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  home_total_members INTEGER NOT NULL DEFAULT 0,
  home_observed_members INTEGER NOT NULL DEFAULT 0,
  home_observed_roster_percent REAL NOT NULL DEFAULT 0,
  home_available_count INTEGER NOT NULL DEFAULT 0,
  home_hospital_count INTEGER NOT NULL DEFAULT 0,
  home_travel_count INTEGER NOT NULL DEFAULT 0,
  home_unknown_count INTEGER NOT NULL DEFAULT 0,
  home_local_relevant_count INTEGER NOT NULL DEFAULT 0,
  enemy_total_members INTEGER NOT NULL DEFAULT 0,
  enemy_observed_members INTEGER NOT NULL DEFAULT 0,
  enemy_observed_roster_percent REAL NOT NULL DEFAULT 0,
  enemy_available_count INTEGER NOT NULL DEFAULT 0,
  enemy_hospital_count INTEGER NOT NULL DEFAULT 0,
  enemy_travel_count INTEGER NOT NULL DEFAULT 0,
  enemy_unknown_count INTEGER NOT NULL DEFAULT 0,
  enemy_local_relevant_count INTEGER NOT NULL DEFAULT 0,
  home_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  enemy_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  home_attacks_last_15m INTEGER NOT NULL DEFAULT 0,
  enemy_attacks_last_15m INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_total_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_available_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_hospital_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_travel_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_recently_active_count INTEGER NOT NULL DEFAULT 0,
  home_hospital_ratio REAL NOT NULL DEFAULT 0,
  enemy_hospital_ratio REAL NOT NULL DEFAULT 0,
  home_available_ratio REAL NOT NULL DEFAULT 0,
  enemy_available_ratio REAL NOT NULL DEFAULT 0,
  home_status_age_seconds INTEGER NOT NULL DEFAULT 0,
  enemy_status_age_seconds INTEGER NOT NULL DEFAULT 0,
  control_state TEXT NOT NULL,
  control_confidence REAL NOT NULL DEFAULT 0,
  control_reason TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, bucket_start),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE INDEX IF NOT EXISTS idx_war_control_snapshots_war_created
  ON war_control_snapshots(war_id, created_at DESC);
