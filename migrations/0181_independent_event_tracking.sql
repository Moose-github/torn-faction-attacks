-- Event membership is a time-window projection, independent of war ownership.
CREATE VIEW tracker_attacks AS
SELECT a.id, a.war_id, a.code, a.started, a.ended,
  a.attacker_id, a.attacker_name, a.attacker_level, a.attacker_faction_id, a.attacker_faction_name,
  a.defender_id, a.defender_name, a.defender_level, a.defender_faction_id, a.defender_faction_name,
  a.result, a.respect_gain, a.respect_loss, a.chain, a.is_interrupted,
  a.is_stealthed, a.is_raid, a.is_ranked_war, a.m_fair_fight, a.m_war,
  a.m_retaliation, a.m_group, a.m_overseas, a.m_chain, a.m_warlord,
  a.fetched_at, a.ingest_run_id, a.stats_pending
FROM attacks a
WHERE a.war_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM wars w WHERE w.id = a.war_id AND w.war_type = 'event'
)
UNION ALL
SELECT a.id, w.id AS war_id, a.code, a.started, a.ended,
  a.attacker_id, a.attacker_name, a.attacker_level, a.attacker_faction_id, a.attacker_faction_name,
  a.defender_id, a.defender_name, a.defender_level, a.defender_faction_id, a.defender_faction_name,
  a.result, a.respect_gain, a.respect_loss, a.chain,
  a.is_interrupted, a.is_stealthed, a.is_raid, a.is_ranked_war,
  a.m_fair_fight, a.m_war, a.m_retaliation, a.m_group, a.m_overseas, a.m_chain, a.m_warlord,
  a.fetched_at, a.ingest_run_id, a.stats_pending
FROM wars w JOIN attacks a
  ON a.started >= w.practical_start_time
  AND (w.practical_finish_time IS NULL OR COALESCE(a.ended, a.started) <= w.practical_finish_time)
WHERE w.war_type = 'event'
  AND (a.attacker_faction_id = 8803 OR a.defender_faction_id = 8803);

-- Legacy ownership is released by the new worker on its first ingestion run,
-- after deployment. Applying this additive migration alone keeps old code usable.
