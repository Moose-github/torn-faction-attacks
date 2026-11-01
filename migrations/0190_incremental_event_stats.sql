-- Independent event work queues survive retries and do not consume war stats_pending.
CREATE TABLE event_stats_dirty (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  PRIMARY KEY (war_id, member_id, bucket_start)
);

CREATE TRIGGER event_stats_attack_insert AFTER INSERT ON attacks
BEGIN
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, NEW.attacker_id, CAST(NEW.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND NEW.attacker_faction_id = 8803 AND NEW.attacker_id IS NOT NULL
  UNION
  SELECT w.id, NEW.defender_id, CAST(NEW.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND NEW.defender_faction_id = 8803 AND NEW.defender_id IS NOT NULL
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER event_stats_attack_update AFTER UPDATE OF started, ended, attacker_id, attacker_name, attacker_faction_id, defender_id, defender_name, defender_faction_id, result, respect_gain, chain, m_fair_fight, m_retaliation, is_ranked_war ON attacks
WHEN OLD.started IS NOT NEW.started
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
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, OLD.attacker_id, CAST(OLD.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND OLD.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time)
    AND OLD.attacker_faction_id = 8803 AND OLD.attacker_id IS NOT NULL
  UNION
  SELECT w.id, OLD.defender_id, CAST(OLD.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND OLD.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time)
    AND OLD.defender_faction_id = 8803 AND OLD.defender_id IS NOT NULL
  UNION
  SELECT w.id, NEW.attacker_id, CAST(NEW.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND NEW.attacker_faction_id = 8803 AND NEW.attacker_id IS NOT NULL
  UNION
  SELECT w.id, NEW.defender_id, CAST(NEW.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND NEW.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(NEW.ended, NEW.started) <= w.practical_finish_time)
    AND NEW.defender_faction_id = 8803 AND NEW.defender_id IS NOT NULL
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

CREATE TRIGGER event_stats_attack_delete AFTER DELETE ON attacks
BEGIN
  INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
  SELECT w.id, OLD.attacker_id, CAST(OLD.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND OLD.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time)
    AND OLD.attacker_faction_id = 8803 AND OLD.attacker_id IS NOT NULL
  UNION
  SELECT w.id, OLD.defender_id, CAST(OLD.started / 900 AS INTEGER) * 900
  FROM wars w
  WHERE w.war_type = 'event' AND w.status IN ('scheduled', 'active', 'ended')
    AND OLD.started >= w.practical_start_time
    AND (w.practical_finish_time IS NULL OR COALESCE(OLD.ended, OLD.started) <= w.practical_finish_time)
    AND OLD.defender_faction_id = 8803 AND OLD.defender_id IS NOT NULL
  ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
END;

-- Catch up existing live events once when the new worker starts. Include old
-- summary locations as well as raw attacks so stale rows can be removed.
INSERT INTO event_stats_dirty (war_id, member_id, bucket_start)
SELECT b.war_id, b.member_id, b.bucket_start FROM war_member_combat_buckets b
JOIN wars w ON w.id = b.war_id WHERE w.war_type = 'event' AND w.status = 'active'
UNION
SELECT s.war_id, s.member_id, -1 FROM war_member_stats s
JOIN wars w ON w.id = s.war_id WHERE w.war_type = 'event' AND w.status = 'active'
UNION
SELECT a.war_id, a.attacker_id, CAST(a.started / 900 AS INTEGER) * 900 FROM tracker_attacks a
JOIN wars w ON w.id = a.war_id
WHERE w.war_type = 'event' AND w.status = 'active'
  AND a.attacker_faction_id = 8803 AND a.attacker_id IS NOT NULL AND a.started IS NOT NULL
UNION
SELECT a.war_id, a.defender_id, CAST(a.started / 900 AS INTEGER) * 900 FROM tracker_attacks a
JOIN wars w ON w.id = a.war_id
WHERE w.war_type = 'event' AND w.status = 'active'
  AND a.defender_faction_id = 8803 AND a.defender_id IS NOT NULL AND a.started IS NOT NULL
ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING;
