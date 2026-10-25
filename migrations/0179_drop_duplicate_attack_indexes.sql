-- 0128 recreated two attacks indexes that already existed under other names:
-- idx_attacks_retaliation_enemy_list   = idx_attacks_defender_faction_started (0062)
-- idx_attacks_retaliation_claim_lookup = idx_attacks_retaliation_claim_recent (0089)
-- The duplicates add write cost to every attack insert without helping any query.
DROP INDEX IF EXISTS idx_attacks_retaliation_enemy_list;
DROP INDEX IF EXISTS idx_attacks_retaliation_claim_lookup;
