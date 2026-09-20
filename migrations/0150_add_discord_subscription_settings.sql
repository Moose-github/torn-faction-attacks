-- Missing rows use the existing defaults in DISCORD_ALERTS.
-- Member choices are retained separately when subscriptions are paused.
CREATE TABLE discord_alert_subscription_settings (
  alert_key TEXT PRIMARY KEY,
  subscribable INTEGER NOT NULL CHECK (subscribable IN (0, 1)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
