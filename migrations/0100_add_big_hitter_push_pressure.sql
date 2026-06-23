ALTER TABLE enemy_push_activity_snapshots
  ADD COLUMN big_hitter_total_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE enemy_push_activity_snapshots
  ADD COLUMN big_hitter_online_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE enemy_push_activity_snapshots
  ADD COLUMN big_hitter_recently_active_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE enemy_push_activity_snapshots
  ADD COLUMN big_hitter_pressure_multiplier REAL NOT NULL DEFAULT 1;

ALTER TABLE enemy_push_activity_snapshots
  ADD COLUMN base_pressure_score INTEGER NOT NULL DEFAULT 0;
