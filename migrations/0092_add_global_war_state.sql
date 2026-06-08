ALTER TABLE sync_state ADD COLUMN war_state TEXT NOT NULL DEFAULT 'none';

UPDATE wars
SET status = 'active'
WHERE status = 'ended'
  AND official_end_time IS NULL
  AND practical_finish_time IS NOT NULL;

INSERT INTO sync_state (name, last_started, active_war_id, war_state, updated_at)
VALUES ('attacks', 0, NULL, 'none', CURRENT_TIMESTAMP)
ON CONFLICT(name) DO NOTHING;

UPDATE sync_state
SET war_state = 'none',
    active_war_id = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'attacks';

UPDATE sync_state
SET war_state = 'upcoming',
    active_war_id = (
      SELECT id
      FROM wars
      WHERE status = 'scheduled'
      ORDER BY practical_start_time ASC
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'attacks'
  AND EXISTS (
    SELECT 1
    FROM wars
    WHERE status = 'scheduled'
  );

UPDATE sync_state
SET war_state = 'practically_finished',
    active_war_id = (
      SELECT id
      FROM wars
      WHERE status = 'active'
        AND official_end_time IS NULL
        AND practical_finish_time IS NOT NULL
      ORDER BY practical_finish_time DESC, practical_start_time DESC
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'attacks'
  AND EXISTS (
    SELECT 1
    FROM wars
    WHERE status = 'active'
      AND official_end_time IS NULL
      AND practical_finish_time IS NOT NULL
  );

UPDATE sync_state
SET war_state = 'current',
    active_war_id = (
      SELECT id
      FROM wars
      WHERE status = 'active'
        AND official_end_time IS NULL
        AND practical_finish_time IS NULL
      ORDER BY practical_start_time DESC
      LIMIT 1
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'attacks'
  AND EXISTS (
    SELECT 1
    FROM wars
    WHERE status = 'active'
      AND official_end_time IS NULL
      AND practical_finish_time IS NULL
  );
