-- Events read their attacks through event_id as wars read war_id, so both use
-- war_stats_dirty and one set of triggers: each attack queues its war and its
-- event. The triggers look both up by id instead of matching every event window.
INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
SELECT war_id, member_id, bucket_start FROM event_stats_dirty WHERE true
ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;

DROP TRIGGER event_stats_attack_insert;
DROP TRIGGER event_stats_attack_update;
DROP TRIGGER event_stats_attack_delete;
DROP TRIGGER war_stats_attack_insert;
DROP TRIGGER war_stats_attack_delete;
DROP TRIGGER war_stats_war_update;
DROP TRIGGER war_stats_unknown_event_insert;
DROP TRIGGER war_stats_unknown_event_update;
DROP TRIGGER war_stats_unknown_event_delete;
DROP TABLE event_stats_dirty;

-- war_id pointing at an event is legacy ownership the tracker ignores.
CREATE TRIGGER war_stats_attack_insert AFTER INSERT ON attacks
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, COALESCE(NEW.attacker_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id IN (NEW.war_id, NEW.event_id)
    AND (w.id IS NEW.event_id OR COALESCE(w.war_type, 'real') != 'event')
    AND NEW.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.defender_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id IN (NEW.war_id, NEW.event_id)
    AND (w.id IS NEW.event_id OR COALESCE(w.war_type, 'real') != 'event')
    AND NEW.defender_faction_id = 8803
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

-- Wars keep their own update trigger, so a war_id change does not requeue the
-- event and an event_id change does not requeue the war.
CREATE TRIGGER war_stats_attack_event_update AFTER UPDATE OF event_id, started, ended, attacker_id, attacker_name, attacker_faction_id, defender_id, defender_name, defender_faction_id, result, respect_gain, chain, m_fair_fight, m_retaliation, is_ranked_war ON attacks
WHEN OLD.event_id IS NOT NEW.event_id
  OR OLD.started IS NOT NEW.started
  OR OLD.ended IS NOT NEW.ended
  OR OLD.attacker_id IS NOT NEW.attacker_id
  OR OLD.attacker_name IS NOT NEW.attacker_name
  OR OLD.attacker_faction_id IS NOT NEW.attacker_faction_id
  OR OLD.defender_id IS NOT NEW.defender_id
  OR OLD.defender_name IS NOT NEW.defender_name
  OR OLD.defender_faction_id IS NOT NEW.defender_faction_id
  OR OLD.result IS NOT NEW.result
  OR OLD.respect_gain IS NOT NEW.respect_gain
  OR OLD.chain IS NOT NEW.chain
  OR OLD.m_fair_fight IS NOT NEW.m_fair_fight
  OR OLD.m_retaliation IS NOT NEW.m_retaliation
  OR OLD.is_ranked_war IS NOT NEW.is_ranked_war
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, COALESCE(OLD.attacker_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w WHERE w.id = OLD.event_id AND OLD.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(OLD.defender_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w WHERE w.id = OLD.event_id AND OLD.defender_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.attacker_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w WHERE w.id = NEW.event_id AND NEW.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.defender_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w WHERE w.id = NEW.event_id AND NEW.defender_faction_id = 8803
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_attack_delete AFTER DELETE ON attacks
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, COALESCE(OLD.attacker_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id IN (OLD.war_id, OLD.event_id)
    AND (w.id IS OLD.event_id OR COALESCE(w.war_type, 'real') != 'event')
    AND OLD.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(OLD.defender_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id IN (OLD.war_id, OLD.event_id)
    AND (w.id IS OLD.event_id OR COALESCE(w.war_type, 'real') != 'event')
    AND OLD.defender_faction_id = 8803
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_war_update AFTER UPDATE OF war_type, practical_start_time, practical_finish_time, official_end_time, enemy_faction_id ON wars
WHEN OLD.war_type IS NOT NEW.war_type
  OR OLD.enemy_faction_id IS NOT NEW.enemy_faction_id
  OR (NEW.war_type = 'termed' AND OLD.official_end_time IS NOT NEW.official_end_time)
  OR (COALESCE(NEW.war_type, 'real') != 'termed' AND (
    OLD.practical_start_time IS NOT NEW.practical_start_time
    OR OLD.practical_finish_time IS NOT NEW.practical_finish_time))
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  VALUES (NEW.id, -1, -1)
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_insert AFTER INSERT ON war_respect_totals
WHEN NEW.direction = 'outgoing' AND NEW.attacker_id = 0
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = NEW.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_update AFTER UPDATE ON war_respect_totals
WHEN NEW.direction = 'outgoing' AND NEW.attacker_id = 0
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = NEW.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_delete AFTER DELETE ON war_respect_totals
WHEN OLD.direction = 'outgoing' AND OLD.attacker_id = 0
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = OLD.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

-- Replaced by the event_id indexes from 0196 and the bonus index below.
DROP INDEX idx_attacks_attacker_started;
DROP INDEX idx_attacks_defender_started;
DROP INDEX idx_attacks_bonus_started;

-- Only event bonus hits enter this index, like idx_attacks_war_bonus for wars.
CREATE INDEX idx_attacks_event_bonus ON attacks (event_id, started)
WHERE event_id IS NOT NULL
  AND result IN ('Hospitalized','Mugged','Attacked','Arrested')
  AND chain IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000);
