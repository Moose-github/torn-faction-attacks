CREATE INDEX IF NOT EXISTS idx_attacks_attacker_faction_started
ON attacks(attacker_faction_id, started DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_defender_faction_started
ON attacks(defender_faction_id, started DESC, id DESC);
