-- Migration number: 0010
-- Live Torn scores are stored directly in home_report_score and enemy_report_score.

ALTER TABLE wars DROP COLUMN last_respect_check_at;
ALTER TABLE wars DROP COLUMN last_observed_respect;
