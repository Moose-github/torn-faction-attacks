DROP INDEX IF EXISTS idx_member_lifestyle_stats_updated;
DROP INDEX IF EXISTS idx_member_lifestyle_stats_bucket_date;
DROP TABLE IF EXISTS member_lifestyle_stats;

DELETE FROM sync_state
WHERE name IN (
  'member_lifestyle_stats_daily',
  'member_gym_contributors_daily',
  'member_lifestyle_stats_daily_lock',
  'member_lifestyle_stats_daily_reset'
);
