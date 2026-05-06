INSERT INTO sync_state (name, last_started, active_war_id)
SELECT
  'member_lifestyle_stats_daily',
  CAST(strftime('%s', MAX(substr(name, length('member_lifestyle_stats_daily_') + 1)) || ' 00:10:00') AS INTEGER),
  NULL
FROM sync_state
WHERE name LIKE 'member_lifestyle_stats_daily_____-__-__'
  AND length(name) = length('member_lifestyle_stats_daily_') + 10
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
WHERE name LIKE 'member_gym_contributors_daily_____-__-__'
  AND length(name) = length('member_gym_contributors_daily_') + 10
HAVING MAX(substr(name, length('member_gym_contributors_daily_') + 1)) IS NOT NULL
ON CONFLICT(name) DO UPDATE SET
  last_started = CASE
    WHEN sync_state.last_started >= excluded.last_started THEN sync_state.last_started
    ELSE excluded.last_started
  END,
  updated_at = CURRENT_TIMESTAMP;

DELETE FROM sync_state
WHERE (
    name LIKE 'member_lifestyle_stats_daily_____-__-__'
    AND length(name) = length('member_lifestyle_stats_daily_') + 10
  )
   OR (
    name LIKE 'member_gym_contributors_daily_____-__-__'
    AND length(name) = length('member_gym_contributors_daily_') + 10
  );
