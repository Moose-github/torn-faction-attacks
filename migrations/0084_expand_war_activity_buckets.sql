ALTER TABLE war_member_activity_buckets
  ADD COLUMN assists_vs_enemy INTEGER NOT NULL DEFAULT 0;

ALTER TABLE war_member_activity_buckets
  ADD COLUMN defends_won INTEGER NOT NULL DEFAULT 0;

ALTER TABLE war_member_activity_buckets
  ADD COLUMN defends_other INTEGER NOT NULL DEFAULT 0;

WITH bucket_rows AS (
  SELECT
    a.war_id,
    a.attacker_id AS member_id,
    CAST((a.started / 900) AS INTEGER) * 900 AS bucket_start,
    SUM(CASE
      WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
       AND a.result = 'Assist'
      THEN 1
      ELSE 0
    END) AS assists_vs_enemy,
    0 AS defends_won,
    0 AS defends_other
  FROM attacks a
  JOIN wars w ON w.id = a.war_id
  WHERE a.war_id IS NOT NULL
    AND a.started IS NOT NULL
    AND a.attacker_faction_id = 8803
    AND a.attacker_id IS NOT NULL
    AND (
      a.started IS NULL
      OR (
        a.started >= w.practical_start_time
        AND (w.practical_finish_time IS NULL OR a.started <= w.practical_finish_time)
      )
    )
  GROUP BY a.war_id, a.attacker_id, bucket_start
  HAVING assists_vs_enemy > 0

  UNION ALL

  SELECT
    a.war_id,
    a.defender_id AS member_id,
    CAST((a.started / 900) AS INTEGER) * 900 AS bucket_start,
    0 AS assists_vs_enemy,
    SUM(CASE
      WHEN a.result IN ('Lost') THEN 1
      ELSE 0
    END) AS defends_won,
    SUM(CASE
      WHEN a.result IS NULL
        OR (
          a.result NOT IN ('Hospitalized','Mugged','Attacked','Arrested')
          AND a.result NOT IN ('Lost')
        )
      THEN 1
      ELSE 0
    END) AS defends_other
  FROM attacks a
  JOIN wars w ON w.id = a.war_id
  WHERE a.war_id IS NOT NULL
    AND a.started IS NOT NULL
    AND a.defender_faction_id = 8803
    AND a.defender_id IS NOT NULL
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
  GROUP BY a.war_id, a.defender_id, bucket_start
  HAVING defends_won > 0
    OR defends_other > 0
),
grouped_rows AS (
  SELECT
    war_id,
    member_id,
    bucket_start,
    SUM(assists_vs_enemy) AS assists_vs_enemy,
    SUM(defends_won) AS defends_won,
    SUM(defends_other) AS defends_other
  FROM bucket_rows
  GROUP BY war_id, member_id, bucket_start
)
INSERT INTO war_member_activity_buckets (
  war_id,
  member_id,
  bucket_start,
  attacks_successful,
  assists_vs_enemy,
  outside_hits,
  defends_lost,
  defends_won,
  defends_other,
  respect_gained,
  respect_lost
)
SELECT
  war_id,
  member_id,
  bucket_start,
  0,
  assists_vs_enemy,
  0,
  0,
  defends_won,
  defends_other,
  0,
  0
FROM grouped_rows
WHERE true
ON CONFLICT(war_id, member_id, bucket_start) DO UPDATE SET
  assists_vs_enemy = excluded.assists_vs_enemy,
  defends_won = excluded.defends_won,
  defends_other = excluded.defends_other;
