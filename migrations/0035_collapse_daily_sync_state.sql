INSERT INTO sync_state (name, last_started, active_war_id)
SELECT
  'member_lifestyle_stats_daily',
  CAST(strftime('%s', MAX(substr(name, length('member_lifestyle_stats_daily_') + 1)) || ' 00:10:00') AS INTEGER),
  NULL
FROM sync_state
WHERE name GLOB 'member_lifestyle_stats_daily_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
HAVING MAX(substr(name, length('member_lifestyle_stats_daily_') + 1)) IS NOT NULL
ON CONFLICT(name) DO UPDATE SET
  last_started = CASE
    WHEN sync_state.last_started >= excluded.last_started THEN sync_state.last_started
    ELSE excluded.last_started
  END,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO sync_state (name, last_started, active_war_id)
SELECT
  'member_gym_contributors_daily',
  CAST(strftime('%s', MAX(substr(name, length('member_gym_contributors_daily_') + 1)) || ' 00:10:00') AS INTEGER),
  NULL
FROM sync_state
WHERE name GLOB 'member_gym_contributors_daily_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
HAVING MAX(substr(name, length('member_gym_contributors_daily_') + 1)) IS NOT NULL
ON CONFLICT(name) DO UPDATE SET
  last_started = CASE
    WHEN sync_state.last_started >= excluded.last_started THEN sync_state.last_started
    ELSE excluded.last_started
  END,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM sync_state
WHERE name GLOB 'member_lifestyle_stats_daily_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
   OR name GLOB 'member_gym_contributors_daily_[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
