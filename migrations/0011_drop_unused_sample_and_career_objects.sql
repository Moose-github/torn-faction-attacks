-- Migration number: 0011
-- Remove unused sample/career objects and redundant attack indexes.

DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS member_career_stats;

DROP INDEX IF EXISTS idx_member_career_stats_name;
DROP INDEX IF EXISTS idx_attacks_attacker_war;
DROP INDEX IF EXISTS idx_attacks_defender_war;
