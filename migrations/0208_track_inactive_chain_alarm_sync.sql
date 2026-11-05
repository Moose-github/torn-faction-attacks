-- NULL forces one reconciliation for existing inactive monitors after upgrade.
ALTER TABLE faction_chain_watch_state ADD COLUMN inactive_alarm_synced_version INTEGER;
