DELETE FROM sync_state
WHERE length(name) = length('member_lifestyle_stats_daily_') + 10
  AND substr(name, 1, length('member_lifestyle_stats_daily_')) = 'member_lifestyle_stats_daily_'
  AND substr(name, length('member_lifestyle_stats_daily_') + 5, 1) = '-'
  AND substr(name, length('member_lifestyle_stats_daily_') + 8, 1) = '-';

DELETE FROM sync_state
WHERE length(name) = length('member_gym_contributors_daily_') + 10
  AND substr(name, 1, length('member_gym_contributors_daily_')) = 'member_gym_contributors_daily_'
  AND substr(name, length('member_gym_contributors_daily_') + 5, 1) = '-'
  AND substr(name, length('member_gym_contributors_daily_') + 8, 1) = '-';
