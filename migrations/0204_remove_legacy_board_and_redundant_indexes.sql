-- Production already dropped this table when the original 0203 ran. No deployed
-- code reads it, and this keeps databases built from the migrations in step.
DROP TABLE IF EXISTS retaliation_board_state;

-- Exact duplicates of each table's unique key.
DROP INDEX IF EXISTS idx_enemy_hit_stat_snapshots_member;
DROP INDEX IF EXISTS idx_member_lifestyle_xantaken_rechecks_member_date;

-- Reads use the primary key or another index on these tables.
DROP INDEX IF EXISTS idx_war_control_snapshots_war_created;
DROP INDEX IF EXISTS idx_member_lifestyle_repair_items_status;
DROP INDEX IF EXISTS idx_retaliation_opportunities_expires;
DROP INDEX IF EXISTS idx_retaliation_claim_signals_expires;
DROP INDEX IF EXISTS idx_retaliation_claim_signals_target;
