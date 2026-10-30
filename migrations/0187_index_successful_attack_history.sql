CREATE INDEX idx_attacks_successful_hit_at
  ON attacks (attacker_faction_id, COALESCE(ended, started))
  WHERE result IN ('Hospitalized','Mugged','Attacked','Arrested');
