-- Slots and timestamps left by the retired hourly, quarter-hour and event
-- rebuild jobs. Queued corrections replaced them; nothing reads these rows.
DELETE FROM sync_state
WHERE name IN (
  'cron_slot:hourly_war_summaries',
  'cron_slot:chain_bonus_correction',
  'open_war_member_stats_rebuild'
)
  OR name LIKE 'cron\_slot:event\_stats\_rebuild:%' ESCAPE '\';
