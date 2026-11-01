-- Events do not own attacks by war_id. Queued event summaries read a member's
-- attacks inside the event window instead of scanning every home attack in it.
CREATE INDEX idx_attacks_attacker_started ON attacks (attacker_id, started);
CREATE INDEX idx_attacks_defender_started ON attacks (defender_id, started);

-- Only bonus hits enter this index; events find theirs by time, not war_id.
CREATE INDEX idx_attacks_bonus_started ON attacks (started)
WHERE result IN ('Hospitalized','Mugged','Attacked','Arrested')
  AND chain IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000);
