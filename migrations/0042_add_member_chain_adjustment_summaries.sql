ALTER TABLE war_member_stats
  ADD COLUMN chain_bonus_hits_vs_enemy INTEGER NOT NULL DEFAULT 0;

ALTER TABLE war_member_stats
  ADD COLUMN chain_bonus_respect_removed REAL NOT NULL DEFAULT 0;

ALTER TABLE war_member_stats
  ADD COLUMN enemy_chain_bonus_hits_received INTEGER NOT NULL DEFAULT 0;

ALTER TABLE war_member_stats
  ADD COLUMN enemy_chain_bonus_respect_removed REAL NOT NULL DEFAULT 0;
