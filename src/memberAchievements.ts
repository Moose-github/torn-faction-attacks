import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";

const ACHIEVEMENT_TOP_RANKS = 3;
const ACHIEVEMENT_DETAIL_VERSION = 5;
const ACHIEVEMENT_METRICS = [
  {
    metricKey: "xanax_yesterday",
    metricGroup: "xanax",
    metricTitle: "Most Xanax on last completed day",
    periodKey: "yesterday",
    unit: "xanax",
    source: "lifestyle",
    field: "xantaken",
    days: 1,
    valueKind: "total",
  },
  {
    metricKey: "xanax_average_7d",
    metricGroup: "xanax",
    metricTitle: "Highest average Xanax over last complete 7-day period",
    periodKey: "last_7_completed_days",
    unit: "xanax/day",
    source: "lifestyle",
    field: "xantaken",
    days: 7,
    valueKind: "daily_average",
  },
  {
    metricKey: "gymenergy_yesterday",
    metricGroup: "gym_energy",
    metricTitle: "Most Gym energy on last completed day",
    periodKey: "yesterday",
    unit: "energy",
    source: "lifestyle",
    field: "gymenergy",
    days: 1,
    valueKind: "total",
  },
  {
    metricKey: "gymenergy_7d",
    metricGroup: "gym_energy",
    metricTitle: "Most Gym energy over last complete 7-day period",
    periodKey: "last_7_completed_days",
    unit: "energy",
    source: "lifestyle",
    field: "gymenergy",
    days: 7,
    valueKind: "total",
  },
  {
    metricKey: "mugs_yesterday",
    metricGroup: "mugs",
    metricTitle: "Most mugs on last completed day",
    periodKey: "yesterday",
    unit: "mugs",
    source: "attacks",
    days: 1,
    valueKind: "total",
  },
  {
    metricKey: "mugs_7d",
    metricGroup: "mugs",
    metricTitle: "Most mugs over last complete 7-day period",
    periodKey: "last_7_completed_days",
    unit: "mugs",
    source: "attacks",
    days: 7,
    valueKind: "total",
  },
] as const;

type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];

type AchievementRow = {
  metricKey: string;
  metricGroup: string;
  metricTitle: string;
  periodKey: string;
  rank: number;
  memberId: number;
  memberName: string | null;
  value: number;
  unit: string;
  periodStartDate: string;
  periodEndDate: string;
  sourceSnapshotDate: string;
  detailJson: string;
  computedAt: number;
};

type SnapshotValueRow = {
  member_id: number;
  member_name: string | null;
  start_value: number | null;
  end_value: number | null;
};

type MugRow = {
  member_id: number;
  member_name: string | null;
  value: number;
};

type AvailableAchievementDates = {
  fully: Set<string>;
  gym: Set<string>;
  personal: Set<string>;
};

type MetricSourceSnapshotDates = Map<string, string>;

export async function listMemberAchievementSummaries(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `
    SELECT
      metric_key,
      metric_group,
      metric_title,
      period_key,
      rank,
      member_id,
      member_name,
      value,
      unit,
      period_start_date,
      period_end_date,
      source_snapshot_date,
      detail_json,
      computed_at
    FROM member_achievement_summaries
    ORDER BY metric_group ASC, metric_key ASC, rank ASC
    `,
  ).all();

  return json({
    ok: true,
    achievements: rows.results ?? [],
  });
}

export async function refreshMemberAchievementSummariesIfStale(
  env: Env,
): Promise<{ writeStatements: number; changedRows: number; skipped: boolean; reason?: string }> {
  const availableDates = await readAvailableSnapshotDates(env);
  const sourceSnapshotDates = latestSnapshotDatesForMetrics(availableDates);
  if (sourceSnapshotDates.size === 0) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "no complete lifestyle snapshots" };
  }

  if (await summariesAreCurrent(env, sourceSnapshotDates, availableDates)) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "already current" };
  }

  return refreshMemberAchievementSummaries(env, sourceSnapshotDates, availableDates);
}

export async function refreshMemberAchievementSummaries(
  env: Env,
  latestSnapshotDate?: string | MetricSourceSnapshotDates,
  knownAvailableDates?: AvailableAchievementDates,
): Promise<{ writeStatements: number; changedRows: number; skipped: boolean; reason?: string }> {
  const availableDates = knownAvailableDates ?? await readAvailableSnapshotDates(env);
  const sourceSnapshotDates = typeof latestSnapshotDate === "string"
    ? fixedSnapshotDateForMetrics(latestSnapshotDate)
    : latestSnapshotDate ?? latestSnapshotDatesForMetrics(availableDates);
  if (sourceSnapshotDates.size === 0) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "no complete lifestyle snapshots" };
  }

  const rows: AchievementRow[] = [];
  const computedAt = nowSeconds();

  for (const metric of ACHIEVEMENT_METRICS) {
    const sourceSnapshotDate = sourceSnapshotDates.get(metric.metricKey);
    if (!sourceSnapshotDate) {
      continue;
    }

    const baselineDate = shiftUtcDate(sourceSnapshotDate, -metric.days);
    if (!metricHasAvailableWindow(metric, availableDates, baselineDate, sourceSnapshotDate)) {
      continue;
    }

    const period = {
      startDate: baselineDate,
      endDate: shiftUtcDate(sourceSnapshotDate, -1),
    };

    const rankedRows = metric.source === "lifestyle"
      ? await rankedLifestyleRows(env, metric, baselineDate, sourceSnapshotDate)
      : await rankedMugRows(env, baselineDate, sourceSnapshotDate);

    rows.push(
      ...rankedRows.slice(0, ACHIEVEMENT_TOP_RANKS).map((row, index) => ({
        metricKey: metric.metricKey,
        metricGroup: metric.metricGroup,
        metricTitle: metric.metricTitle,
        periodKey: metric.periodKey,
        rank: index + 1,
        memberId: row.member_id,
        memberName: row.member_name,
        value: row.value,
        unit: metric.unit,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        sourceSnapshotDate,
        detailJson: JSON.stringify({
          days: metric.days,
          baseline_date: baselineDate,
          value_kind: metric.valueKind,
          version: ACHIEVEMENT_DETAIL_VERSION,
        }),
        computedAt,
      })),
    );
  }

  const statements = [
    env.DB.prepare("DELETE FROM member_achievement_summaries"),
    ...rows.map((row) =>
      env.DB.prepare(
        `
        INSERT INTO member_achievement_summaries (
          metric_key,
          metric_group,
          metric_title,
          period_key,
          rank,
          member_id,
          member_name,
          value,
          unit,
          period_start_date,
          period_end_date,
          source_snapshot_date,
          detail_json,
          computed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        row.metricKey,
        row.metricGroup,
        row.metricTitle,
        row.periodKey,
        row.rank,
        row.memberId,
        row.memberName,
        row.value,
        row.unit,
        row.periodStartDate,
        row.periodEndDate,
        row.sourceSnapshotDate,
        row.detailJson,
        row.computedAt,
      ),
    ),
  ];

  const results = await env.DB.batch(statements);
  return {
    writeStatements: statements.length,
    changedRows: results.reduce((total: number, result: unknown) => total + d1Changes(result), 0),
    skipped: false,
  };
}

async function rankedLifestyleRows(
  env: Env,
  metric: Extract<AchievementMetric, { source: "lifestyle" }>,
  baselineDate: string,
  sourceSnapshotDate: string,
): Promise<MugRow[]> {
  const readyColumn = lifestyleReadyColumnForMetric(metric);
  const rows = ((await env.DB.prepare(
    `
    SELECT
      end_snapshot.member_id,
      COALESCE(end_snapshot.member_name, start_snapshot.member_name, members.name) AS member_name,
      start_snapshot.${metric.field} AS start_value,
      end_snapshot.${metric.field} AS end_value
    FROM member_lifestyle_stat_snapshots end_snapshot
    JOIN member_lifestyle_stat_snapshots start_snapshot
      ON start_snapshot.member_id = end_snapshot.member_id
     AND start_snapshot.snapshot_date = ?
    JOIN home_faction_members members
      ON members.member_id = end_snapshot.member_id
    WHERE end_snapshot.snapshot_date = ?
      AND end_snapshot.${readyColumn} = 1
      AND start_snapshot.${readyColumn} = 1
      AND members.faction_id = ?
      AND members.is_current = 1
      AND members.report_exempt = 0
    `,
  )
    .bind(baselineDate, sourceSnapshotDate, HOME_FACTION_ID)
    .all()).results ?? []) as SnapshotValueRow[];

  return rows
    .map((row) => {
      if (row.start_value === null || row.end_value === null) {
        return null;
      }
      const delta = Math.max(0, Number(row.end_value) - Number(row.start_value));
      const value = metric.valueKind === "daily_average"
        ? delta / metric.days
        : delta;
      return {
        member_id: row.member_id,
        member_name: row.member_name,
        value,
      };
    })
    .filter((row): row is MugRow => row !== null && row.value > 0)
    .sort(compareRankedRows);
}

function lifestyleReadyColumnForMetric(
  metric: Extract<AchievementMetric, { source: "lifestyle" }>,
): "personal_ready" | "gym_ready" {
  return metric.field.startsWith("gym") ? "gym_ready" : "personal_ready";
}

async function rankedMugRows(
  env: Env,
  startDate: string,
  endDateExclusive: string,
): Promise<MugRow[]> {
  const rows = ((await env.DB.prepare(
    `
    SELECT
      attacks.attacker_id AS member_id,
      COALESCE(MAX(attacks.attacker_name), MAX(members.name)) AS member_name,
      COUNT(*) AS value
    FROM attacks
    JOIN home_faction_members members
      ON members.member_id = attacks.attacker_id
     AND members.faction_id = ?
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE attacks.started >= ?
      AND attacks.started < ?
      AND attacks.attacker_faction_id = ?
      AND attacks.result = 'Mugged'
      AND attacks.attacker_id IS NOT NULL
    GROUP BY attacks.attacker_id
    `,
  )
    .bind(HOME_FACTION_ID, utcDateToSeconds(startDate), utcDateToSeconds(endDateExclusive), HOME_FACTION_ID)
    .all()).results ?? []) as MugRow[];

  return rows
    .map((row) => ({
      member_id: Number(row.member_id),
      member_name: row.member_name,
      value: Number(row.value),
    }))
    .filter((row) => Number.isInteger(row.member_id) && row.member_id > 0 && row.value > 0)
    .sort(compareRankedRows);
}

function compareRankedRows(left: MugRow, right: MugRow): number {
  if (right.value !== left.value) {
    return right.value - left.value;
  }

  return (left.member_name ?? `#${left.member_id}`).localeCompare(right.member_name ?? `#${right.member_id}`);
}

async function readAvailableSnapshotDates(env: Env): Promise<AvailableAchievementDates> {
  const rows = ((await env.DB.prepare(
    `
    WITH candidate_dates AS (
      SELECT DISTINCT snapshot_date
      FROM member_lifestyle_stat_snapshots
    )
    SELECT
      candidate_dates.snapshot_date,
      CASE WHEN NOT EXISTS (
        SELECT 1
        FROM home_faction_members members
        LEFT JOIN member_lifestyle_stat_snapshots snapshots
          ON snapshots.member_id = members.member_id
         AND snapshots.snapshot_date = candidate_dates.snapshot_date
         AND snapshots.personal_ready = 1
        WHERE members.faction_id = ?
          AND members.is_current = 1
          AND members.report_exempt = 0
          AND snapshots.member_id IS NULL
      ) THEN 1 ELSE 0 END AS personal_ready,
      CASE WHEN NOT EXISTS (
        SELECT 1
        FROM home_faction_members members
        LEFT JOIN member_lifestyle_stat_snapshots snapshots
          ON snapshots.member_id = members.member_id
         AND snapshots.snapshot_date = candidate_dates.snapshot_date
         AND snapshots.gym_ready = 1
        WHERE members.faction_id = ?
          AND members.is_current = 1
          AND members.report_exempt = 0
          AND snapshots.member_id IS NULL
      ) THEN 1 ELSE 0 END AS gym_ready,
      CASE WHEN NOT EXISTS (
        SELECT 1
        FROM home_faction_members members
        LEFT JOIN member_lifestyle_stat_snapshots snapshots
          ON snapshots.member_id = members.member_id
         AND snapshots.snapshot_date = candidate_dates.snapshot_date
         AND snapshots.fully_ready = 1
        WHERE members.faction_id = ?
          AND members.is_current = 1
          AND members.report_exempt = 0
          AND snapshots.member_id IS NULL
      ) THEN 1 ELSE 0 END AS fully_ready
    FROM candidate_dates
    `,
  )
    .bind(HOME_FACTION_ID, HOME_FACTION_ID, HOME_FACTION_ID)
    .all()).results ?? []) as Array<{
    snapshot_date: string;
    personal_ready: number | null;
    gym_ready: number | null;
    fully_ready: number | null;
  }>;

  return {
    fully: new Set(rows.filter((row) => Number(row.fully_ready) > 0).map((row) => row.snapshot_date)),
    gym: new Set(rows.filter((row) => Number(row.gym_ready) > 0).map((row) => row.snapshot_date)),
    personal: new Set(rows.filter((row) => Number(row.personal_ready) > 0).map((row) => row.snapshot_date)),
  };
}

function latestSnapshotDatesForMetrics(availableDates: AvailableAchievementDates): MetricSourceSnapshotDates {
  const sourceSnapshotDates: MetricSourceSnapshotDates = new Map();
  for (const metric of ACHIEVEMENT_METRICS) {
    const sourceSnapshotDate = latestDateFromSet(readyDatesForMetric(metric, availableDates));
    if (!sourceSnapshotDate) {
      continue;
    }

    const baselineDate = shiftUtcDate(sourceSnapshotDate, -metric.days);
    if (metricHasAvailableWindow(metric, availableDates, baselineDate, sourceSnapshotDate)) {
      sourceSnapshotDates.set(metric.metricKey, sourceSnapshotDate);
    }
  }
  return sourceSnapshotDates;
}

function fixedSnapshotDateForMetrics(sourceSnapshotDate: string): MetricSourceSnapshotDates {
  return new Map(ACHIEVEMENT_METRICS.map((metric) => [metric.metricKey, sourceSnapshotDate]));
}

function readyDatesForMetric(
  metric: AchievementMetric,
  availableDates: AvailableAchievementDates,
): Set<string> {
  if (metric.source === "attacks") {
    return availableDates.fully;
  }

  return metric.field.startsWith("gym") ? availableDates.gym : availableDates.personal;
}

function latestDateFromSet(dates: Set<string>): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (latest === null || date > latest) {
      latest = date;
    }
  }
  return latest;
}

async function summariesAreCurrent(
  env: Env,
  sourceSnapshotDates: MetricSourceSnapshotDates,
  availableDates: AvailableAchievementDates,
): Promise<boolean> {
  const rows = ((await env.DB.prepare(
    `
    SELECT metric_key, source_snapshot_date, detail_json
    FROM member_achievement_summaries
    `,
  )
    .all()).results ?? []) as Array<{
    metric_key: string;
    source_snapshot_date: string | null;
    detail_json: string | null;
  }>;

  const expectedMetricSources = expectedMetricSourcesForSnapshots(sourceSnapshotDates, availableDates);
  if (expectedMetricSources.size === 0) {
    return rows.length === 0;
  }
  if (rows.length === 0) {
    return false;
  }

  const presentMetricKeys = new Set(rows.map((row) => row.metric_key));
  for (const [metricKey] of expectedMetricSources) {
    if (!presentMetricKeys.has(metricKey)) {
      return false;
    }
  }

  return rows.every((row) =>
    expectedMetricSources.get(row.metric_key) === row.source_snapshot_date &&
    achievementDetailVersion(row.detail_json) === ACHIEVEMENT_DETAIL_VERSION
  );
}

function expectedMetricSourcesForSnapshots(
  sourceSnapshotDates: MetricSourceSnapshotDates,
  availableDates: AvailableAchievementDates,
): MetricSourceSnapshotDates {
  const expectedMetricSources: MetricSourceSnapshotDates = new Map();
  for (const metric of ACHIEVEMENT_METRICS) {
    const sourceSnapshotDate = sourceSnapshotDates.get(metric.metricKey);
    if (!sourceSnapshotDate) {
      continue;
    }

    if (metricHasAvailableWindow(
      metric,
      availableDates,
      shiftUtcDate(sourceSnapshotDate, -metric.days),
      sourceSnapshotDate,
    )) {
      expectedMetricSources.set(metric.metricKey, sourceSnapshotDate);
    }
  }
  return expectedMetricSources;
}

function metricHasAvailableWindow(
  metric: AchievementMetric,
  availableDates: AvailableAchievementDates,
  baselineDate: string,
  sourceSnapshotDate: string,
): boolean {
  if (metric.source === "attacks") {
    return true;
  }

  const readyDates = metric.field.startsWith("gym") ? availableDates.gym : availableDates.personal;
  return readyDates.has(baselineDate) && readyDates.has(sourceSnapshotDate);
}

function achievementDetailVersion(detailJson: string | null): number | null {
  if (!detailJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(detailJson) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : null;
  } catch {
    return null;
  }
}

function shiftUtcDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcDateToSeconds(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / 1000);
}
