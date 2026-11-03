-- Apply after the Worker that no longer reads retaliation_board_state is deployed.

-- attacks: no query filters on ingest_run_id, but ingestion keeps rewriting it.
DROP INDEX IF EXISTS idx_attacks_ingest_run_war_attacker;
DROP INDEX IF EXISTS idx_attacks_ingest_run_war_defender;
DROP INDEX IF EXISTS idx_attacks_war_ingest_run;

-- No query plan chooses these; the primary keys and remaining indexes cover every read.
DROP INDEX IF EXISTS idx_member_lifestyle_snapshots_personal_ready;
DROP INDEX IF EXISTS idx_member_lifestyle_snapshots_gym_ready;
DROP INDEX IF EXISTS idx_member_lifestyle_snapshots_fully_ready;
DROP INDEX IF EXISTS idx_member_lifestyle_snapshots_bucket_date;
DROP INDEX IF EXISTS idx_home_member_live_status_state;
DROP INDEX IF EXISTS idx_home_member_live_status_travel;
DROP INDEX IF EXISTS idx_enemy_member_live_status_state;
DROP INDEX IF EXISTS idx_enemy_member_live_status_travel;
DROP INDEX IF EXISTS idx_enemy_member_activity_samples_war_member;
DROP INDEX IF EXISTS idx_enemy_member_activity_samples_war_bucket;
DROP INDEX IF EXISTS idx_enemy_faction_activity_samples_war_bucket;
DROP INDEX IF EXISTS idx_enemy_faction_activity_samples_faction_sampled;
DROP INDEX IF EXISTS idx_home_faction_activity_samples_sampled;

-- Each is the leading column of a wider index on the same table.
DROP INDEX IF EXISTS idx_home_faction_members_faction;
DROP INDEX IF EXISTS idx_enemy_faction_members_faction;

-- Retired: nothing reads or writes the item groups, and the legacy board is retired.
DROP TABLE IF EXISTS item_group_items;
DROP TABLE IF EXISTS item_groups;
DROP TABLE IF EXISTS retaliation_board_state;

ALTER TABLE ingestion_runs DROP COLUMN heatmap_finished_at;
ALTER TABLE wars DROP COLUMN auto_end_enabled;

-- Keys left behind by features whose code has been removed.
DELETE FROM sync_state WHERE name IN (
  'member_lifestyle_stats_refresh',
  'member_lifestyle_stats_stale_discord_alert',
  'member_personal_stats_current_daily',
  'member_personal_stats_current_daily_lock',
  'member_personal_stats_current_daily_reset'
);
DELETE FROM sync_state WHERE name LIKE 'enemy\_travel\_cleared:%' ESCAPE '\';
