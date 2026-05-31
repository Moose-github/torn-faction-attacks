const WAR_COLUMN_NAMES = [
  "id",
  "name",
  "status",
  "practical_start_time",
  "practical_finish_time",
  "official_start_time",
  "official_end_time",
  "enemy_faction_id",
  "war_type",
  "torn_war_id",
  "auto_end_enabled",
  "faction_respect_limit",
  "member_respect_limit",
  "winner_faction_id",
  "torn_report_fetched_at",
  "official_home_score",
  "official_home_attacks",
  "official_enemy_score",
  "official_enemy_attacks",
  "enemy_scouting_auto_attempted_at",
  "enemy_scouting_status_checked_at",
  "finalized_at",
];

export const WAR_RETURNING_COLUMNS = WAR_COLUMN_NAMES.join(",\n        ");

export const WAR_SELECT_COLUMNS = WAR_COLUMN_NAMES.join(",\n        ");

export const WAR_SELECT_COLUMNS_WITH_ALIAS = WAR_COLUMN_NAMES.map(
  (column) => `w.${column}`,
).join(",\n        ");

export const OUTGOING_ACTION_WINDOW_SQL = `
  (
    a.started IS NULL
    OR (
      a.started >= w.practical_start_time
      AND (
        w.practical_finish_time IS NULL
        OR COALESCE(a.ended, a.started) <= w.practical_finish_time
      )
    )
  )
`;

export const DEFENSE_ACTION_WINDOW_SQL = `
  (
    a.started IS NULL
    OR (
      a.started >= COALESCE(w.official_start_time, w.practical_start_time)
      AND (
        w.official_end_time IS NOT NULL
        AND COALESCE(a.ended, a.started) <= w.official_end_time
      )
    )
    OR (
      w.official_end_time IS NULL
      AND w.status = 'active'
      AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
      AND (
        w.practical_finish_time IS NULL
        OR COALESCE(a.ended, a.started) <= w.practical_finish_time
      )
    )
    OR (
      w.official_end_time IS NULL
      AND w.status != 'active'
      AND a.started >= COALESCE(w.official_start_time, w.practical_start_time)
      AND (
        w.practical_finish_time IS NULL
        OR COALESCE(a.ended, a.started) <= w.practical_finish_time
      )
    )
  )
`;
