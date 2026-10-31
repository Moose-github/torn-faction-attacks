ALTER TABLE faction_chain_watch_state
  ADD COLUMN manual_enabled INTEGER NOT NULL DEFAULT 0 CHECK (manual_enabled IN (0, 1));
