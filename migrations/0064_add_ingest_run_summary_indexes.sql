CREATE INDEX IF NOT EXISTS idx_attacks_ingest_run_war_attacker
ON attacks(ingest_run_id, war_id, attacker_faction_id, attacker_id);

CREATE INDEX IF NOT EXISTS idx_attacks_ingest_run_war_defender
ON attacks(ingest_run_id, war_id, defender_faction_id, defender_id);
