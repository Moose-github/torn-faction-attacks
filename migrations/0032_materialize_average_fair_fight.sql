ALTER TABLE war_member_stats
  ADD COLUMN average_fair_fight REAL;

CREATE INDEX IF NOT EXISTS idx_war_member_stats_war_respect
  ON war_member_stats(war_id, enemy_respect_gained DESC, enemy_attacks_successful DESC, enemy_attacks_total DESC);
