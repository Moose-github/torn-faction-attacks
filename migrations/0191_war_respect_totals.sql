-- Exact non-bonus sums/counts for events, normal wars and termed practical phases.
-- Counts match AVG: missing respect is excluded; unknown attackers use key 0.
CREATE TABLE war_respect_totals (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('outgoing', 'incoming')),
  attacker_id INTEGER NOT NULL,
  respect_sum REAL NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (war_id, direction, attacker_id)
);

-- Used only for initialization and boundary/phase edits, never routine averages.
CREATE VIEW war_respect_contributions AS
  SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(a.attacker_id, 0) AS attacker_id,
    a.respect_gain AS respect_sum, 1 AS hit_count
  FROM tracker_attacks a JOIN wars w ON w.id = a.war_id
  WHERE (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        a.started IS NULL OR (a.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(a.ended, a.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((a.started IS NULL AND pp.reason = 'legacy') OR (
            a.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(a.ended, a.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(a.ended, a.started) <= w.official_end_time)
          ))
      ))
    )
    AND a.attacker_faction_id = 8803
    AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
    AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND a.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'incoming' AS direction, COALESCE(a.attacker_id, 0) AS attacker_id,
    a.respect_gain AS respect_sum, 1 AS hit_count
  FROM tracker_attacks a JOIN wars w ON w.id = a.war_id
  WHERE (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        a.started IS NULL OR (a.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(a.ended, a.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((a.started IS NULL AND pp.reason = 'legacy') OR (
            a.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(a.ended, a.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(a.ended, a.started) <= w.official_end_time)
          ))
      ))
    )
    AND a.defender_faction_id = 8803 AND a.defender_id IS NOT NULL
    AND (w.war_type = 'event' OR (w.enemy_faction_id IS NOT NULL
      AND (a.attacker_faction_id = w.enemy_faction_id OR (a.attacker_faction_id IS NULL AND a.is_ranked_war = 1))))
    AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND a.respect_gain IS NOT NULL;

CREATE TRIGGER war_respect_attack_insert AFTER INSERT ON attacks
BEGIN
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(NEW.attacker_id, 0) AS attacker_id,
    NEW.respect_gain AS respect_sum, 1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND NEW.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = NEW.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        NEW.started IS NULL OR (NEW.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((NEW.started IS NULL AND pp.reason = 'legacy') OR (
            NEW.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.official_end_time)
          ))
      ))
    )
    AND NEW.attacker_faction_id = 8803
    AND (w.enemy_faction_id IS NULL OR NEW.defender_faction_id = w.enemy_faction_id)
    AND NEW.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (NEW.chain IS NULL OR NEW.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND NEW.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'incoming' AS direction, COALESCE(NEW.attacker_id, 0) AS attacker_id,
    NEW.respect_gain AS respect_sum, 1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND NEW.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = NEW.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        NEW.started IS NULL OR (NEW.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((NEW.started IS NULL AND pp.reason = 'legacy') OR (
            NEW.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.official_end_time)
          ))
      ))
    )
    AND NEW.defender_faction_id = 8803 AND NEW.defender_id IS NOT NULL
    AND (w.war_type = 'event' OR (w.enemy_faction_id IS NOT NULL
      AND (NEW.attacker_faction_id = w.enemy_faction_id OR (NEW.attacker_faction_id IS NULL AND NEW.is_ranked_war = 1))))
    AND NEW.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (NEW.chain IS NULL OR NEW.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND NEW.respect_gain IS NOT NULL)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0
  ON CONFLICT(war_id, direction, attacker_id) DO UPDATE SET
    respect_sum = CASE WHEN war_respect_totals.hit_count + excluded.hit_count = 0 THEN 0
      ELSE war_respect_totals.respect_sum + excluded.respect_sum END,
    hit_count = war_respect_totals.hit_count + excluded.hit_count;
END;

CREATE TRIGGER war_respect_attack_update AFTER UPDATE OF war_id, started, ended, attacker_id, attacker_faction_id, defender_id, defender_faction_id, result, respect_gain, chain, is_ranked_war ON attacks
WHEN OLD.war_id IS NOT NEW.war_id
  OR OLD.started IS NOT NEW.started
  OR OLD.ended IS NOT NEW.ended
  OR OLD.attacker_id IS NOT NEW.attacker_id
  OR OLD.attacker_faction_id IS NOT NEW.attacker_faction_id
  OR OLD.defender_id IS NOT NEW.defender_id
  OR OLD.defender_faction_id IS NOT NEW.defender_faction_id
  OR OLD.result IS NOT NEW.result
  OR OLD.respect_gain IS NOT NEW.respect_gain
  OR OLD.chain IS NOT NEW.chain
  OR OLD.is_ranked_war IS NOT NEW.is_ranked_war
BEGIN
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(OLD.attacker_id, 0) AS attacker_id,
    -OLD.respect_gain AS respect_sum, -1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND OLD.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = OLD.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        OLD.started IS NULL OR (OLD.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((OLD.started IS NULL AND pp.reason = 'legacy') OR (
            OLD.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.official_end_time)
          ))
      ))
    )
    AND OLD.attacker_faction_id = 8803
    AND (w.enemy_faction_id IS NULL OR OLD.defender_faction_id = w.enemy_faction_id)
    AND OLD.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (OLD.chain IS NULL OR OLD.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND OLD.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'incoming' AS direction, COALESCE(OLD.attacker_id, 0) AS attacker_id,
    -OLD.respect_gain AS respect_sum, -1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND OLD.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = OLD.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        OLD.started IS NULL OR (OLD.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((OLD.started IS NULL AND pp.reason = 'legacy') OR (
            OLD.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.official_end_time)
          ))
      ))
    )
    AND OLD.defender_faction_id = 8803 AND OLD.defender_id IS NOT NULL
    AND (w.war_type = 'event' OR (w.enemy_faction_id IS NOT NULL
      AND (OLD.attacker_faction_id = w.enemy_faction_id OR (OLD.attacker_faction_id IS NULL AND OLD.is_ranked_war = 1))))
    AND OLD.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (OLD.chain IS NULL OR OLD.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND OLD.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(NEW.attacker_id, 0) AS attacker_id,
    NEW.respect_gain AS respect_sum, 1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND NEW.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = NEW.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        NEW.started IS NULL OR (NEW.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((NEW.started IS NULL AND pp.reason = 'legacy') OR (
            NEW.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.official_end_time)
          ))
      ))
    )
    AND NEW.attacker_faction_id = 8803
    AND (w.enemy_faction_id IS NULL OR NEW.defender_faction_id = w.enemy_faction_id)
    AND NEW.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (NEW.chain IS NULL OR NEW.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND NEW.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'incoming' AS direction, COALESCE(NEW.attacker_id, 0) AS attacker_id,
    NEW.respect_gain AS respect_sum, 1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND NEW.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = NEW.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        NEW.started IS NULL OR (NEW.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((NEW.started IS NULL AND pp.reason = 'legacy') OR (
            NEW.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.official_end_time)
          ))
      ))
    )
    AND NEW.defender_faction_id = 8803 AND NEW.defender_id IS NOT NULL
    AND (w.war_type = 'event' OR (w.enemy_faction_id IS NOT NULL
      AND (NEW.attacker_faction_id = w.enemy_faction_id OR (NEW.attacker_faction_id IS NULL AND NEW.is_ranked_war = 1))))
    AND NEW.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (NEW.chain IS NULL OR NEW.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND NEW.respect_gain IS NOT NULL)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0
  ON CONFLICT(war_id, direction, attacker_id) DO UPDATE SET
    respect_sum = CASE WHEN war_respect_totals.hit_count + excluded.hit_count = 0 THEN 0
      ELSE war_respect_totals.respect_sum + excluded.respect_sum END,
    hit_count = war_respect_totals.hit_count + excluded.hit_count;
END;

CREATE TRIGGER war_respect_attack_delete AFTER DELETE ON attacks
BEGIN
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(OLD.attacker_id, 0) AS attacker_id,
    -OLD.respect_gain AS respect_sum, -1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND OLD.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = OLD.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        OLD.started IS NULL OR (OLD.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((OLD.started IS NULL AND pp.reason = 'legacy') OR (
            OLD.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.official_end_time)
          ))
      ))
    )
    AND OLD.attacker_faction_id = 8803
    AND (w.enemy_faction_id IS NULL OR OLD.defender_faction_id = w.enemy_faction_id)
    AND OLD.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (OLD.chain IS NULL OR OLD.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND OLD.respect_gain IS NOT NULL
  UNION ALL
  SELECT w.id AS war_id, 'incoming' AS direction, COALESCE(OLD.attacker_id, 0) AS attacker_id,
    -OLD.respect_gain AS respect_sum, -1 AS hit_count
  FROM wars w
  WHERE ((w.war_type = 'event' AND OLD.started IS NOT NULL)
      OR (COALESCE(w.war_type, 'real') != 'event' AND w.id = OLD.war_id))
    AND (
      (COALESCE(w.war_type, 'real') != 'termed' AND (
        OLD.started IS NULL OR (OLD.started >= w.practical_start_time
          AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time))
      ))
      OR (w.war_type = 'termed' AND EXISTS (
        SELECT 1 FROM war_practical_phases pp WHERE pp.war_id = w.id
          AND pp.removed_at IS NULL AND pp.status IN ('active', 'completed')
          AND ((OLD.started IS NULL AND pp.reason = 'legacy') OR (
            OLD.started >= pp.start_time
            AND (pp.finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= pp.finish_time)
            AND (w.official_end_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.official_end_time)
          ))
      ))
    )
    AND OLD.defender_faction_id = 8803 AND OLD.defender_id IS NOT NULL
    AND (w.war_type = 'event' OR (w.enemy_faction_id IS NOT NULL
      AND (OLD.attacker_faction_id = w.enemy_faction_id OR (OLD.attacker_faction_id IS NULL AND OLD.is_ranked_war = 1))))
    AND OLD.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (OLD.chain IS NULL OR OLD.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
    AND OLD.respect_gain IS NOT NULL)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0
  ON CONFLICT(war_id, direction, attacker_id) DO UPDATE SET
    respect_sum = CASE WHEN war_respect_totals.hit_count + excluded.hit_count = 0 THEN 0
      ELSE war_respect_totals.respect_sum + excluded.respect_sum END,
    hit_count = war_respect_totals.hit_count + excluded.hit_count;
END;

CREATE TRIGGER war_respect_war_insert AFTER INSERT ON wars
BEGIN
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions WHERE war_id = NEW.id)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
END;

-- Termed eligibility uses phases and official end, not the compatibility window.
CREATE TRIGGER war_respect_war_update AFTER UPDATE OF war_type, practical_start_time, practical_finish_time, official_end_time, enemy_faction_id ON wars
WHEN OLD.war_type IS NOT NEW.war_type
  OR OLD.enemy_faction_id IS NOT NEW.enemy_faction_id
  OR (NEW.war_type = 'termed' AND OLD.official_end_time IS NOT NEW.official_end_time)
  OR (COALESCE(NEW.war_type, 'real') != 'termed' AND (
    OLD.practical_start_time IS NOT NEW.practical_start_time
    OR OLD.practical_finish_time IS NOT NEW.practical_finish_time))
BEGIN
  DELETE FROM war_respect_totals WHERE war_id = OLD.id;
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions WHERE war_id = NEW.id)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
END;

CREATE TRIGGER war_respect_phase_insert AFTER INSERT ON war_practical_phases
WHEN NEW.removed_at IS NULL AND NEW.status IN ('active', 'completed')
  AND EXISTS (SELECT 1 FROM wars WHERE id = NEW.war_id AND war_type = 'termed')
BEGIN
  DELETE FROM war_respect_totals WHERE war_id = NEW.war_id;
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions WHERE war_id = NEW.war_id)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
END;

CREATE TRIGGER war_respect_phase_update AFTER UPDATE OF war_id, start_time, finish_time, status, reason, removed_at ON war_practical_phases
WHEN (OLD.war_id IS NOT NEW.war_id OR OLD.start_time IS NOT NEW.start_time
  OR OLD.finish_time IS NOT NEW.finish_time OR OLD.status IS NOT NEW.status
  OR OLD.reason IS NOT NEW.reason OR OLD.removed_at IS NOT NEW.removed_at)
  AND ((OLD.removed_at IS NULL AND OLD.status IN ('active', 'completed'))
    OR (NEW.removed_at IS NULL AND NEW.status IN ('active', 'completed')))
BEGIN
  DELETE FROM war_respect_totals WHERE war_id IN (OLD.war_id, NEW.war_id)
    AND war_id IN (SELECT id FROM wars WHERE war_type = 'termed');
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions WHERE war_id IN (OLD.war_id, NEW.war_id) AND war_id IN (SELECT id FROM wars WHERE war_type = 'termed'))
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
END;

CREATE TRIGGER war_respect_phase_delete AFTER DELETE ON war_practical_phases
WHEN OLD.removed_at IS NULL AND OLD.status IN ('active', 'completed')
  AND EXISTS (SELECT 1 FROM wars WHERE id = OLD.war_id AND war_type = 'termed')
BEGIN
  DELETE FROM war_respect_totals WHERE war_id = OLD.war_id;
  INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions WHERE war_id = OLD.war_id)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
END;

-- One-time initialization; attack triggers then apply only changed contributions.
INSERT INTO war_respect_totals (war_id, direction, attacker_id, respect_sum, hit_count)
  SELECT war_id, direction, attacker_id, SUM(respect_sum), SUM(hit_count)
  FROM (SELECT * FROM war_respect_contributions)
  GROUP BY war_id, direction, attacker_id
  HAVING SUM(hit_count) != 0 OR SUM(respect_sum) != 0;
