ALTER TABLE war_summary RENAME COLUMN faction_attacks TO attacks_vs_enemy_total;
ALTER TABLE war_summary RENAME COLUMN enemy_attacks TO attacks_from_enemy_total;
ALTER TABLE war_summary RENAME COLUMN outside_hits_outgoing TO outside_hits;
