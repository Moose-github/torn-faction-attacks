-- Migration number: 0004
-- Adds event typing and termed-war limit fields to wars.

ALTER TABLE wars ADD COLUMN torn_war_id INTEGER;
ALTER TABLE wars ADD COLUMN auto_end_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wars ADD COLUMN faction_respect_limit REAL;
ALTER TABLE wars ADD COLUMN member_respect_limit REAL;
ALTER TABLE wars ADD COLUMN last_respect_check_at INTEGER;
ALTER TABLE wars ADD COLUMN last_observed_respect REAL;

UPDATE wars
SET war_type = 'real'
WHERE war_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_wars_war_type
    ON wars(war_type);

CREATE INDEX IF NOT EXISTS idx_wars_torn_war_id
    ON wars(torn_war_id);
