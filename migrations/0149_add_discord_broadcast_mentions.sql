CREATE TABLE discord_admin_alert_subscriptions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  subscription_type TEXT NOT NULL CHECK (subscription_type IN ('user', 'role', 'everyone', 'here')),
  discord_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(alert_key, subscription_type, discord_id)
);

INSERT INTO discord_admin_alert_subscriptions_new
  SELECT * FROM discord_admin_alert_subscriptions;
DROP TABLE discord_admin_alert_subscriptions;
ALTER TABLE discord_admin_alert_subscriptions_new RENAME TO discord_admin_alert_subscriptions;
CREATE INDEX idx_discord_admin_alert_subscriptions_alert
  ON discord_admin_alert_subscriptions (alert_key, enabled);
