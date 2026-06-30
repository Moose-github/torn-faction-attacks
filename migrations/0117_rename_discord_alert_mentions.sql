ALTER TABLE discord_alert_mentions
  RENAME TO discord_admin_alert_subscriptions;

ALTER TABLE discord_admin_alert_subscriptions
  RENAME COLUMN mention_type TO subscription_type;

DROP INDEX IF EXISTS idx_discord_alert_mentions_alert;

CREATE INDEX IF NOT EXISTS idx_discord_admin_alert_subscriptions_alert
  ON discord_admin_alert_subscriptions (alert_key, enabled);
