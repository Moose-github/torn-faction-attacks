ALTER TABLE war_control_settings DROP COLUMN status_freshness_max_seconds;

ALTER TABLE war_control_snapshots DROP COLUMN home_status_age_seconds;

ALTER TABLE war_control_snapshots DROP COLUMN enemy_status_age_seconds;
