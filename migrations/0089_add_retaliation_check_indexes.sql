CREATE INDEX IF NOT EXISTS idx_attacks_retaliation_enemy_recent
ON attacks(attacker_id, defender_faction_id, started DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_retaliation_claim_recent
ON attacks(defender_id, attacker_faction_id, started DESC, id DESC);
