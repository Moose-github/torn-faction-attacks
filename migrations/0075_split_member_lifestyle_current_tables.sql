CREATE TABLE member_personal_stats_current (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  daysbeendonator INTEGER,
  xantaken_timestamp INTEGER,
  overdosed_timestamp INTEGER,
  refills_timestamp INTEGER,
  useractivity_timestamp INTEGER,
  networth_timestamp INTEGER,
  daysbeendonator_timestamp INTEGER,
  personalstats_bucket_date TEXT,
  personalstats_requested_at INTEGER,
  personalstats_key_source TEXT,
  personal_captured_at INTEGER,
  validation_error TEXT,
  error TEXT
);

CREATE TABLE member_gym_stats_current (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  gym_captured_at INTEGER,
  gym_error TEXT
);

ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN personal_captured_at INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN gym_captured_at INTEGER;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN personal_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN gym_ready INTEGER NOT NULL DEFAULT 0;
ALTER TABLE member_lifestyle_stat_snapshots ADD COLUMN fully_ready INTEGER NOT NULL DEFAULT 0;

UPDATE member_lifestyle_stat_snapshots
SET personal_captured_at = COALESCE(personal_captured_at, captured_at),
    gym_captured_at = COALESCE(gym_captured_at, captured_at),
    personal_ready = 1,
    gym_ready = 1,
    fully_ready = 1;

DELETE FROM member_lifestyle_stats;

DELETE FROM sync_state
WHERE name IN (
  'member_lifestyle_stats_daily',
  'member_gym_contributors_daily',
  'member_lifestyle_stats_daily_lock',
  'member_lifestyle_stats_daily_reset'
);

CREATE INDEX idx_member_personal_stats_current_captured
  ON member_personal_stats_current(personal_captured_at);

CREATE INDEX idx_member_personal_stats_current_bucket
  ON member_personal_stats_current(personalstats_bucket_date);

CREATE INDEX idx_member_gym_stats_current_captured
  ON member_gym_stats_current(gym_captured_at);

CREATE INDEX idx_member_lifestyle_snapshots_personal_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, personal_ready);

CREATE INDEX idx_member_lifestyle_snapshots_gym_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, gym_ready);

CREATE INDEX idx_member_lifestyle_snapshots_fully_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, fully_ready);
