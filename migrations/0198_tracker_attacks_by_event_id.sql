-- Read event attacks through event_id (0196) instead of matching every event's
-- window against all home attacks since it started, and drop the per-attack
-- wars lookup that doubled the rows read for wars. Columns are unchanged.
DROP VIEW tracker_attacks;

-- Wars own attacks through war_id and events through event_id, so an attack can
-- appear under its war and its event. No attack is owned by an event through
-- war_id (the event link audit checks this), so neither branch looks up wars.
CREATE VIEW tracker_attacks AS
SELECT a.id, a.war_id, a.code, a.started, a.ended,
  a.attacker_id, a.attacker_name, a.attacker_level, a.attacker_faction_id, a.attacker_faction_name,
  a.defender_id, a.defender_name, a.defender_level, a.defender_faction_id, a.defender_faction_name,
  a.result, a.respect_gain, a.respect_loss, a.chain, a.is_interrupted,
  a.is_stealthed, a.is_raid, a.is_ranked_war, a.m_fair_fight, a.m_war,
  a.m_retaliation, a.m_group, a.m_overseas, a.m_chain, a.m_warlord,
  a.fetched_at, a.ingest_run_id, a.stats_pending
FROM attacks a
UNION ALL
SELECT a.id, a.event_id AS war_id, a.code, a.started, a.ended,
  a.attacker_id, a.attacker_name, a.attacker_level, a.attacker_faction_id, a.attacker_faction_name,
  a.defender_id, a.defender_name, a.defender_level, a.defender_faction_id, a.defender_faction_name,
  a.result, a.respect_gain, a.respect_loss, a.chain, a.is_interrupted,
  a.is_stealthed, a.is_raid, a.is_ranked_war, a.m_fair_fight, a.m_war,
  a.m_retaliation, a.m_group, a.m_overseas, a.m_chain, a.m_warlord,
  a.fetched_at, a.ingest_run_id, a.stats_pending
FROM attacks a
WHERE a.event_id IS NOT NULL;

DROP VIEW war_respect_contributions;

-- Used only for initialization and boundary/phase edits, never routine averages.
-- Events match attacks by window rather than event_id: these recomputes fire on
-- the same wars change as the triggers that move event_id, in no fixed order.
CREATE VIEW war_respect_contributions AS
  SELECT w.id AS war_id, 'outgoing' AS direction, COALESCE(a.attacker_id, 0) AS attacker_id,
    a.respect_gain AS respect_sum, 1 AS hit_count
  FROM (
    SELECT a.war_id, a.started, a.ended, a.attacker_id, a.attacker_faction_id, a.defender_id,
      a.defender_faction_id, a.result, a.respect_gain, a.chain, a.is_ranked_war
    FROM attacks a WHERE a.war_id IS NOT NULL
    UNION ALL
    SELECT ew.id, a.started, a.ended, a.attacker_id, a.attacker_faction_id, a.defender_id,
      a.defender_faction_id, a.result, a.respect_gain, a.chain, a.is_ranked_war
    FROM wars ew JOIN attacks a ON a.started >= ew.practical_start_time
      AND (ew.practical_finish_time IS NULL OR COALESCE(a.ended, a.started) <= ew.practical_finish_time)
    WHERE ew.war_type = 'event' AND (a.attacker_faction_id = 8803 OR a.defender_faction_id = 8803)
  ) a JOIN wars w ON w.id = a.war_id
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
  FROM (
    SELECT a.war_id, a.started, a.ended, a.attacker_id, a.attacker_faction_id, a.defender_id,
      a.defender_faction_id, a.result, a.respect_gain, a.chain, a.is_ranked_war
    FROM attacks a WHERE a.war_id IS NOT NULL
    UNION ALL
    SELECT ew.id, a.started, a.ended, a.attacker_id, a.attacker_faction_id, a.defender_id,
      a.defender_faction_id, a.result, a.respect_gain, a.chain, a.is_ranked_war
    FROM wars ew JOIN attacks a ON a.started >= ew.practical_start_time
      AND (ew.practical_finish_time IS NULL OR COALESCE(a.ended, a.started) <= ew.practical_finish_time)
    WHERE ew.war_type = 'event' AND (a.attacker_faction_id = 8803 OR a.defender_faction_id = 8803)
  ) a JOIN wars w ON w.id = a.war_id
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
