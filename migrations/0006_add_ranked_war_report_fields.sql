ALTER TABLE wars ADD COLUMN winner_faction_id INTEGER;
ALTER TABLE wars ADD COLUMN torn_report_fetched_at INTEGER;
ALTER TABLE wars ADD COLUMN torn_report_start INTEGER;
ALTER TABLE wars ADD COLUMN torn_report_end INTEGER;
ALTER TABLE wars ADD COLUMN home_report_score REAL;
ALTER TABLE wars ADD COLUMN home_report_attacks INTEGER;
ALTER TABLE wars ADD COLUMN enemy_report_score REAL;
ALTER TABLE wars ADD COLUMN enemy_report_attacks INTEGER;

ALTER TABLE war_member_stats ADD COLUMN report_added INTEGER NOT NULL DEFAULT 0;
