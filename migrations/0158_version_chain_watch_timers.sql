-- Invalidate asynchronous work when the accepted timer or activation changes.
ALTER TABLE faction_chain_watch_state ADD COLUMN timer_version INTEGER NOT NULL DEFAULT 0;
