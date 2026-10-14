-- Only rename legacy generated names when an unsuffixed war against the same
-- faction exists. The old generator used numeric suffixes from 2 through 99.
WITH RECURSIVE occurrences(n) AS (
  SELECT 2
  UNION ALL
  SELECT n + 1 FROM occurrences WHERE n < 99
), suffixes AS (
  SELECT ' ' || n AS legacy_suffix,
    ' (' || n || CASE
      WHEN n % 100 BETWEEN 11 AND 13 THEN 'th'
      WHEN n % 10 = 1 THEN 'st'
      WHEN n % 10 = 2 THEN 'nd'
      WHEN n % 10 = 3 THEN 'rd'
      ELSE 'th'
    END || ')' AS ordinal_suffix
  FROM occurrences
), renames AS (
  SELECT repeated.id,
    substr(original.name, 1, 50 - length(ordinal_suffix)) || ordinal_suffix AS new_name
  FROM wars original
  CROSS JOIN suffixes
  JOIN wars repeated ON repeated.enemy_faction_id = original.enemy_faction_id
    AND lower(repeated.name) = lower(substr(original.name, 1, 50 - length(legacy_suffix)) || legacy_suffix)
  WHERE coalesce(original.war_type, 'real') != 'event'
    AND coalesce(repeated.war_type, 'real') != 'event'
)
UPDATE wars
SET name = (SELECT new_name FROM renames WHERE renames.id = wars.id)
WHERE id IN (SELECT id FROM renames)
  AND NOT EXISTS (
    SELECT 1 FROM wars occupied
    WHERE lower(occupied.name) = lower((SELECT new_name FROM renames WHERE renames.id = wars.id))
  );

INSERT INTO sync_state (name, last_started)
VALUES ('cache_version:war:all', unixepoch())
ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started;
