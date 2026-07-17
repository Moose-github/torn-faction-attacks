CREATE TABLE IF NOT EXISTS discord_notification_channels (
  guild_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by_discord_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (guild_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_discord_notification_channels_alert
  ON discord_notification_channels (alert_key, enabled);
