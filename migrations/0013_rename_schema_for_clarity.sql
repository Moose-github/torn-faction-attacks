ALTER TABLE wars RENAME COLUMN faction_id TO enemy_faction_id;
ALTER TABLE wars RENAME COLUMN finish_time TO practical_finish_time;
ALTER TABLE wars RENAME COLUMN home_report_score TO official_home_score;
ALTER TABLE wars RENAME COLUMN home_report_attacks TO official_home_attacks;
ALTER TABLE wars RENAME COLUMN enemy_report_score TO official_enemy_score;
ALTER TABLE wars RENAME COLUMN enemy_report_attacks TO official_enemy_attacks;

ALTER TABLE war_member_stats RENAME COLUMN report_added TO added_from_report;

ALTER TABLE auth_sessions DROP COLUMN name;

ALTER TABLE war_summary DROP COLUMN war_name;
ALTER TABLE war_summary DROP COLUMN status;
ALTER TABLE war_summary DROP COLUMN start_time;
ALTER TABLE war_summary DROP COLUMN finish_time;
ALTER TABLE war_summary DROP COLUMN official_start_time;
ALTER TABLE war_summary DROP COLUMN official_end_time;
ALTER TABLE war_summary DROP COLUMN finalized_at;

DROP INDEX IF EXISTS idx_attacks_attacker_member_war;
DROP INDEX IF EXISTS idx_attacks_defender_member_war;
