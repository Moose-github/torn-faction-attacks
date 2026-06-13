INSERT INTO discord_alert_mentions (alert_key, mention_type, discord_id, enabled)
VALUES ('chain_watch', 'user', '327916221330620436', 1)
ON CONFLICT(alert_key, mention_type, discord_id) DO UPDATE SET
  enabled = excluded.enabled;
