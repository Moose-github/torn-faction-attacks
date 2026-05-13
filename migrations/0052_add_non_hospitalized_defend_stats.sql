ALTER TABLE war_member_stats
  ADD COLUMN defends_lost_non_hospitalized INTEGER NOT NULL DEFAULT 0;

ALTER TABLE war_member_stats
  ADD COLUMN respect_lost_non_hospitalized REAL NOT NULL DEFAULT 0;

WITH member_averages AS (
  SELECT
    a.war_id,
    a.attacker_id,
    AVG(a.respect_gain) AS avg_respect
  FROM attacks a
  JOIN wars w ON w.id = a.war_id
  WHERE a.defender_faction_id = 8803
    AND a.defender_id IS NOT NULL
    AND w.enemy_faction_id IS NOT NULL
    AND a.attacker_faction_id = w.enemy_faction_id
    AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
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
  GROUP BY a.war_id, a.attacker_id
),
war_averages AS (
  SELECT
    a.war_id,
    AVG(a.respect_gain) AS avg_respect
  FROM attacks a
  JOIN wars w ON w.id = a.war_id
  WHERE a.defender_faction_id = 8803
    AND a.defender_id IS NOT NULL
    AND w.enemy_faction_id IS NOT NULL
    AND a.attacker_faction_id = w.enemy_faction_id
    AND a.result IN ('Hospitalized','Mugged','Attacked','Arrested')
    AND (a.chain IS NULL OR a.chain NOT IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000))
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
  GROUP BY a.war_id
),
non_hospitalized_defends AS (
  SELECT
    a.war_id,
    a.defender_id AS member_id,
    COUNT(*) AS defends_lost_non_hospitalized,
    COALESCE(SUM(CASE
      WHEN a.chain IN (10,25,50,100,250,500,1000,2500,5000,10000,25000,50000,100000)
      THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
      ELSE a.respect_gain
    END), 0) AS respect_lost_non_hospitalized
  FROM attacks a
  JOIN wars w ON w.id = a.war_id
  LEFT JOIN member_averages ma ON ma.war_id = a.war_id AND ma.attacker_id = a.attacker_id
  LEFT JOIN war_averages wa ON wa.war_id = a.war_id
  WHERE a.defender_faction_id = 8803
    AND a.defender_id IS NOT NULL
    AND w.enemy_faction_id IS NOT NULL
    AND a.attacker_faction_id = w.enemy_faction_id
    AND a.result IN ('Mugged','Attacked','Arrested')
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
  GROUP BY a.war_id, a.defender_id
)
UPDATE war_member_stats
SET
  defends_lost_non_hospitalized = COALESCE((
    SELECT nh.defends_lost_non_hospitalized
    FROM non_hospitalized_defends nh
    WHERE nh.war_id = war_member_stats.war_id
      AND nh.member_id = war_member_stats.member_id
  ), 0),
  respect_lost_non_hospitalized = COALESCE((
    SELECT nh.respect_lost_non_hospitalized
    FROM non_hospitalized_defends nh
    WHERE nh.war_id = war_member_stats.war_id
      AND nh.member_id = war_member_stats.member_id
  ), 0);
