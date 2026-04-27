export const WAR_COLUMN_NAMES = [
  "id",
  "name",
  "status",
  "start_time",
  "finish_time",
  "official_start_time",
  "official_end_time",
  "faction_id",
  "war_type",
  "torn_war_id",
  "auto_end_enabled",
  "faction_respect_limit",
  "member_respect_limit",
  "winner_faction_id",
  "torn_report_fetched_at",
  "home_report_score",
  "home_report_attacks",
  "enemy_report_score",
  "enemy_report_attacks",
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
      a.started >= w.start_time
      AND (w.finish_time IS NULL OR a.started <= w.finish_time)
    )
  )
`;

export const DEFENSE_ACTION_WINDOW_SQL = `
  (
    a.started IS NULL
    OR (
      a.started >= COALESCE(w.official_start_time, w.start_time)
      AND (
        w.official_end_time IS NOT NULL
        AND a.started <= w.official_end_time
      )
    )
    OR (
      w.official_end_time IS NULL
      AND w.status = 'active'
      AND a.started >= COALESCE(w.official_start_time, w.start_time)
    )
    OR (
      w.official_end_time IS NULL
      AND w.status != 'active'
      AND a.started >= COALESCE(w.official_start_time, w.start_time)
      AND (w.finish_time IS NULL OR a.started <= w.finish_time)
    )
  )
`;
