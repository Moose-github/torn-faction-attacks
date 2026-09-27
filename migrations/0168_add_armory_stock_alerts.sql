-- Current medical stock settings and alert state; no inventory history or new table.
ALTER TABLE faction_armory_state ADD COLUMN stock_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE faction_armory_state ADD COLUMN stock_alert_next_at INTEGER NOT NULL DEFAULT 0;
