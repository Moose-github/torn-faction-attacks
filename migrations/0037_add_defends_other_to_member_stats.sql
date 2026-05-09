ALTER TABLE war_member_stats
  ADD COLUMN defends_other INTEGER NOT NULL DEFAULT 0;

UPDATE war_member_stats AS wms
SET
  defends_total = (
    SELECT COUNT(*)
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    WHERE a.war_id = wms.war_id
      AND a.defender_id = wms.member_id
      AND a.defender_faction_id = 8803
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND (
        a.started IS NULL
        OR (
          a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (
            w.official_end_time IS NOT NULL
            AND a.started <= w.official_end_time
          )
        )
        OR (
          w.official_end_time IS NULL
          AND w.status = 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
        )
        OR (
          w.official_end_time IS NULL
          AND w.status != 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (w.practical_finish_time IS NULL OR a.started <= w.practical_finish_time)
        )
      )
  ),
  defends_won = (
    SELECT COUNT(*)
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    WHERE a.war_id = wms.war_id
      AND a.defender_id = wms.member_id
      AND a.defender_faction_id = 8803
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND a.result = 'Lost'
      AND (
        a.started IS NULL
        OR (
          a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (
            w.official_end_time IS NOT NULL
            AND a.started <= w.official_end_time
          )
        )
        OR (
          w.official_end_time IS NULL
          AND w.status = 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
        )
        OR (
          w.official_end_time IS NULL
          AND w.status != 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (w.practical_finish_time IS NULL OR a.started <= w.practical_finish_time)
        )
      )
  ),
  defends_other = (
    SELECT COUNT(*)
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    WHERE a.war_id = wms.war_id
      AND a.defender_id = wms.member_id
      AND a.defender_faction_id = 8803
      AND w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND (
        a.result IS NULL
        OR (
          a.result NOT IN ('Hospitalized','Mugged','Attacked','Arrested')
          AND a.result != 'Lost'
        )
      )
      AND (
        a.started IS NULL
        OR (
          a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (
            w.official_end_time IS NOT NULL
            AND a.started <= w.official_end_time
          )
        )
        OR (
          w.official_end_time IS NULL
          AND w.status = 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
        )
        OR (
          w.official_end_time IS NULL
          AND w.status != 'active'
          AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
          AND (w.practical_finish_time IS NULL OR a.started <= w.practical_finish_time)
        )
      )
  );
