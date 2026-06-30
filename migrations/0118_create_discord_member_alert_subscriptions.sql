CREATE TABLE IF NOT EXISTS discord_member_alert_subscriptions (
  torn_user_id INTEGER NOT NULL,
  alert_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (torn_user_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_discord_member_alert_subscriptions_alert
  ON discord_member_alert_subscriptions (alert_key, enabled);
