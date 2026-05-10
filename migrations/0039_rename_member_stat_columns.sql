DROP INDEX IF EXISTS idx_war_member_stats_war_respect;
DROP INDEX IF EXISTS idx_member_stats_respect_sort;

ALTER TABLE war_member_stats RENAME COLUMN enemy_attacks_total TO attacks_vs_enemy_total;
ALTER TABLE war_member_stats RENAME COLUMN enemy_attacks_successful TO attacks_vs_enemy_successful;
ALTER TABLE war_member_stats RENAME COLUMN enemy_respect_gained TO respect_gained;
ALTER TABLE war_member_stats RENAME COLUMN enemy_respect_gained_raw TO respect_gained_raw;
ALTER TABLE war_member_stats RENAME COLUMN enemy_assists TO assists_vs_enemy;
ALTER TABLE war_member_stats RENAME COLUMN enemy_hospitalizations TO hospitalizations_vs_enemy;
ALTER TABLE war_member_stats RENAME COLUMN enemy_mugs TO mugs_vs_enemy;
ALTER TABLE war_member_stats RENAME COLUMN enemy_retaliations TO retaliations_vs_enemy;
ALTER TABLE war_member_stats RENAME COLUMN outside_attacks TO outside_hits;
ALTER TABLE war_member_stats RENAME COLUMN friendly_hospitals TO friendly_hosps;

CREATE INDEX IF NOT EXISTS idx_member_stats_respect_sort
  ON war_member_stats(war_id, respect_gained DESC, attacks_vs_enemy_successful DESC, attacks_vs_enemy_total DESC);
