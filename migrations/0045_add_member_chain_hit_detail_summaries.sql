ALTER TABLE war_member_stats
  ADD COLUMN chain_bonus_hit_details_vs_enemy TEXT NOT NULL DEFAULT '';

ALTER TABLE war_member_stats
  ADD COLUMN enemy_chain_bonus_hit_details_received TEXT NOT NULL DEFAULT '';
