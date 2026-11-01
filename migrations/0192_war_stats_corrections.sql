-- Durable exact-replacement work for normal and termed wars.
-- member_id = -1 requests reconciliation after an eligibility/window edit;
-- member_id = 0 tracks unknown attackers that affect the fallback average.
CREATE TABLE war_stats_dirty (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  PRIMARY KEY (war_id, member_id, bucket_start)
);

CREATE TRIGGER war_stats_attack_insert AFTER INSERT ON attacks
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, COALESCE(NEW.attacker_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = NEW.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND NEW.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.defender_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = NEW.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND NEW.defender_faction_id = 8803
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_attack_update AFTER UPDATE OF war_id, started, ended, attacker_id, attacker_name, attacker_faction_id, defender_id, defender_name, defender_faction_id, result, respect_gain, chain, m_fair_fight, m_retaliation, is_ranked_war ON attacks
WHEN OLD.war_id IS NOT NEW.war_id
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
  FROM wars w
  WHERE w.id = OLD.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND OLD.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(OLD.defender_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = OLD.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND OLD.defender_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.attacker_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = NEW.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND NEW.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(NEW.defender_id, 0), COALESCE(CAST(NEW.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = NEW.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND NEW.defender_faction_id = 8803
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_attack_delete AFTER DELETE ON attacks
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, COALESCE(OLD.attacker_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = OLD.war_id AND COALESCE(w.war_type, 'real') != 'event'
    AND OLD.attacker_faction_id = 8803
  UNION
  SELECT w.id, COALESCE(OLD.defender_id, 0), COALESCE(CAST(OLD.started / 900 AS INTEGER) * 900, -1)
  FROM wars w
  WHERE w.id = OLD.war_id AND COALESCE(w.war_type, 'real') != 'event'
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
  SELECT id, -1, -1 FROM wars WHERE id IN (NEW.id) AND COALESCE(war_type, 'real') != 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, -1, -1 FROM wars WHERE id = NEW.id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
  DELETE FROM war_stats_dirty WHERE war_id = NEW.id AND NEW.war_type = 'event';
  DELETE FROM event_stats_dirty WHERE war_id = NEW.id AND COALESCE(NEW.war_type, 'real') != 'event';
END;

CREATE TRIGGER war_stats_phase_insert AFTER INSERT ON war_practical_phases
WHEN NEW.removed_at IS NULL AND NEW.status IN ('active', 'completed')
  AND EXISTS (SELECT 1 FROM wars WHERE id = NEW.war_id AND war_type = 'termed')
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, -1, -1 FROM wars WHERE id IN (NEW.war_id) AND COALESCE(war_type, 'real') != 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_phase_update AFTER UPDATE OF war_id, start_time, finish_time, status, reason, removed_at ON war_practical_phases
WHEN (OLD.war_id IS NOT NEW.war_id OR OLD.start_time IS NOT NEW.start_time
  OR OLD.finish_time IS NOT NEW.finish_time OR OLD.status IS NOT NEW.status
  OR OLD.reason IS NOT NEW.reason OR OLD.removed_at IS NOT NEW.removed_at)
  AND ((OLD.removed_at IS NULL AND OLD.status IN ('active', 'completed'))
    OR (NEW.removed_at IS NULL AND NEW.status IN ('active', 'completed')))
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, -1, -1 FROM wars WHERE id IN (OLD.war_id, NEW.war_id) AND COALESCE(war_type, 'real') != 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_phase_delete AFTER DELETE ON war_practical_phases
WHEN OLD.removed_at IS NULL AND OLD.status IN ('active', 'completed')
  AND EXISTS (SELECT 1 FROM wars WHERE id = OLD.war_id AND war_type = 'termed')
BEGIN
  INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, -1, -1 FROM wars WHERE id IN (OLD.war_id) AND COALESCE(war_type, 'real') != 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_insert AFTER INSERT ON war_respect_totals
WHEN NEW.direction = 'outgoing' AND NEW.attacker_id = 0
BEGIN
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = NEW.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_update AFTER UPDATE ON war_respect_totals
WHEN NEW.direction = 'outgoing' AND NEW.attacker_id = 0
BEGIN
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = NEW.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER war_stats_unknown_event_delete AFTER DELETE ON war_respect_totals
WHEN OLD.direction = 'outgoing' AND OLD.attacker_id = 0
BEGIN
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT id, 0, -1 FROM wars WHERE id = OLD.war_id AND war_type = 'event'
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

-- One-time repair of open wars before retiring periodic reconciliation.
-- Existing ended wars are already finalized; later corrections queue normally.
INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
SELECT id, -1, -1 FROM wars
WHERE COALESCE(war_type, 'real') != 'event' AND (status = 'active' OR practical_rebuild_pending = 1)
ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;

INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
SELECT w.id, 0, -1 FROM wars w JOIN war_respect_totals r ON r.war_id = w.id
WHERE w.war_type = 'event' AND w.status = 'active' AND r.direction = 'outgoing' AND r.attacker_id = 0
ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;

-- Only bonus hits enter this index; ordinary ingestion adds no index row.
CREATE INDEX idx_attacks_war_bonus ON attacks (war_id, started)
WHERE result IN ('Hospitalized','Mugged','Attacked','Arrested')
  AND chain IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000);

-- Acknowledge only outstanding ingestion flags, without scanning war history.
CREATE INDEX idx_attacks_pending_stats ON attacks (war_id) WHERE stats_pending = 1;
