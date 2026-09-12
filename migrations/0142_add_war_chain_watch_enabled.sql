ALTER TABLE wars
  ADD COLUMN chain_watch_enabled INTEGER NOT NULL DEFAULT 1;

UPDATE wars
SET chain_watch_enabled = 0
WHERE COALESCE(war_type, 'real') = 'event';
