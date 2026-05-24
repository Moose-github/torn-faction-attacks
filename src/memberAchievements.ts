import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";

const ACHIEVEMENT_TOP_RANKS = 3;
const ACHIEVEMENT_METRICS = [
  {
    metricKey: "xanax_yesterday",
    metricGroup: "xanax",
    metricTitle: "Most Xanax yesterday",
    periodKey: "yesterday",
    unit: "xanax",
    source: "lifestyle",
    field: "xantaken",
    days: 1,
  },
  {
    metricKey: "xanax_average_7d",
    metricGroup: "xanax",
    metricTitle: "Highest average Xanax over last 7 completed days",
    periodKey: "last_7_completed_days",
    unit: "xanax/day",
    source: "lifestyle",
    field: "xantaken",
    days: 7,
  },
  {
    metricKey: "gymenergy_yesterday",
    metricGroup: "gym_energy",
    metricTitle: "Most Gym energy yesterday",
    periodKey: "yesterday",
    unit: "energy",
    source: "lifestyle",
    field: "gymenergy",
    days: 1,
  },
  {
    metricKey: "gymenergy_average_7d",
    metricGroup: "gym_energy",
    metricTitle: "Highest average Gym energy over last 7 completed days",
    periodKey: "last_7_completed_days",
    unit: "energy/day",
    source: "lifestyle",
    field: "gymenergy",
    days: 7,
  },
  {
    metricKey: "mugs_yesterday",
    metricGroup: "mugs",
    metricTitle: "Most mugs yesterday",
    periodKey: "yesterday",
    unit: "mugs",
    source: "attacks",
    days: 1,
  },
  {
    metricKey: "mugs_7d",
    metricGroup: "mugs",
    metricTitle: "Most mugs over last 7 completed days",
    periodKey: "last_7_completed_days",
    unit: "mugs",
    source: "attacks",
    days: 7,
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
  const latestSnapshotDate = await readLatestSnapshotDate(env);
  if (!latestSnapshotDate) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "no lifestyle snapshots" };
  }

  if (await summariesAreCurrent(env, latestSnapshotDate)) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "already current" };
  }

  return refreshMemberAchievementSummaries(env, latestSnapshotDate);
}

export async function refreshMemberAchievementSummaries(
  env: Env,
  latestSnapshotDate?: string,
): Promise<{ writeStatements: number; changedRows: number; skipped: boolean; reason?: string }> {
  const sourceSnapshotDate = latestSnapshotDate ?? await readLatestSnapshotDate(env);
  if (!sourceSnapshotDate) {
    return { writeStatements: 0, changedRows: 0, skipped: true, reason: "no lifestyle snapshots" };
  }

  const availableDates = await readAvailableSnapshotDates(env);
  const rows: AchievementRow[] = [];
  const computedAt = nowSeconds();

  for (const metric of ACHIEVEMENT_METRICS) {
    const baselineDate = shiftUtcDate(sourceSnapshotDate, -metric.days);
    if (!availableDates.has(baselineDate)) {
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
        detailJson: JSON.stringify({ days: metric.days, baseline_date: baselineDate }),
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
      AND members.faction_id = ?
      AND members.is_current = 1
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
      const value = metric.days > 1 && metric.periodKey.includes("average")
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

async function readLatestSnapshotDate(env: Env): Promise<string | null> {
  const row = (await env.DB.prepare(
    `
    SELECT MAX(snapshot_date) AS snapshot_date
    FROM member_lifestyle_stat_snapshots
    `,
  ).first()) as { snapshot_date: string | null } | null;

  return row?.snapshot_date ?? null;
}

async function readAvailableSnapshotDates(env: Env): Promise<Set<string>> {
  const rows = ((await env.DB.prepare(
    `
    SELECT DISTINCT snapshot_date
    FROM member_lifestyle_stat_snapshots
    `,
  ).all()).results ?? []) as Array<{ snapshot_date: string }>;

  return new Set(rows.map((row) => row.snapshot_date));
}

async function summariesAreCurrent(env: Env, latestSnapshotDate: string): Promise<boolean> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS stale_count
    FROM member_achievement_summaries
    WHERE source_snapshot_date IS NULL
      OR source_snapshot_date != ?
    `,
  )
    .bind(latestSnapshotDate)
    .first()) as { stale_count: number | null } | null;

  const countRow = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS summary_count
    FROM member_achievement_summaries
    `,
  ).first()) as { summary_count: number | null } | null;

  return Number(countRow?.summary_count ?? 0) > 0 && Number(row?.stale_count ?? 0) === 0;
}

function shiftUtcDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function utcDateToSeconds(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / 1000);
}
