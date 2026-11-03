-- Retaliation reads now use retaliation_opportunities, and every attacker_id
-- filter on attacks is scoped by a war or event index.
DROP INDEX IF EXISTS idx_attacks_retaliation_enemy_recent;

-- Both chain > 0 queries also filter on result and use idx_attacks_successful_hit_at.
DROP INDEX IF EXISTS idx_attacks_chain_watch_hit_at;
