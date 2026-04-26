CREATE INDEX IF NOT EXISTS idx_attacks_war_attacker_started
ON attacks (war_id, attacker_id, started DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_war_defender_started
ON attacks (war_id, defender_id, started DESC);
