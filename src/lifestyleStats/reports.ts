import { Env } from "../types";
import { json } from "../utils";
import {
  dateDiffDays,
  dateKeyFromMs,
  enumerateDateRange,
  normalizeDateParam,
} from "./dates";
import {
  GYM_CONTRIBUTOR_STAT_KEYS,
  LIFESTYLE_DAILY_CHART_METRICS,
  MAX_LIFESTYLE_PERIOD_DAYS,
} from "./model";
import type {
  GymContributorStatKey,
  LifestyleDailyChartMetric,
  LifestyleMemberRow,
  LifestylePeriodRow,
  LifestyleSnapshotNumberKey,
  LifestyleSnapshotRow,
  LifestyleStatKey,
} from "./model";
import {
  readCompleteLifestyleSnapshotDateRange,
  readHomeMembersById,
  readLifestyleDailyChartSnapshotRows,
  readLifestylePeriodSnapshotRows,
} from "./queries";

export async function getMemberLifestyleStats(url: URL, env: Env): Promise<Response> {
  const availableRange = await readCompleteLifestyleSnapshotDateRange(env, "fully_ready");
  const period = readLifestylePeriod(url, availableRange);
  const snapshotRows = await readLifestylePeriodSnapshotRows(env, period.start_date, period.end_date);
  const rows = buildPeriodRows(snapshotRows);

  return json({
    ok: true,
    period,
    summary: summarizeLifestylePeriodRows(rows),
    members: rows,
  });
}

export async function getMemberLifestyleDailyChart(url: URL, env: Env): Promise<Response> {
  const metric = parseLifestyleDailyChartMetric(url.searchParams.get("metric"));
  if (!metric) {
    return json({ ok: false, error: "A valid metric is required", code: "INVALID_METRIC" }, 400);
  }
  const readyColumn = lifestyleMetricReadyColumn(metric);
  const availableRange = await readCompleteLifestyleSnapshotDateRange(env, readyColumn);
  const period = readLifestylePeriod(url, availableRange);

  const memberIds = parseLifestyleDailyChartMemberIds(url);
  if (memberIds.length === 0) {
    return json({ ok: false, error: "At least one member_id is required", code: "MISSING_MEMBER_IDS" }, 400);
  }
  if (memberIds.length > 5) {
    return json({ ok: false, error: "Daily chart can compare at most 5 members", code: "TOO_MANY_MEMBERS" }, 400);
  }

  const homeMembers = await readHomeMembersById(env);
  const chartMemberIds = memberIds.filter((memberId) => homeMembers.has(memberId));
  if (chartMemberIds.length === 0) {
    return json({
      ok: true,
      metric,
      period,
      series: [],
    });
  }

  const boundaryDate = dateKeyFromMs(Date.parse(`${period.start_date}T00:00:00.000Z`) - 86_400_000);
  const snapshotRows = await readLifestyleDailyChartSnapshotRows(
    env,
    boundaryDate,
    period.end_date,
    chartMemberIds,
    readyColumn,
  );

  return json({
    ok: true,
    metric,
    period,
    series: buildDailyChartSeries(snapshotRows, chartMemberIds, homeMembers, period.start_date, period.end_date, metric),
  });
}

function buildPeriodRows(rows: LifestyleSnapshotRow[]): LifestylePeriodRow[] {
  const grouped = new Map<number, LifestyleSnapshotRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.member_id) ?? [];
    existing.push(row);
    grouped.set(row.member_id, existing);
  }

  return Array.from(grouped.entries()).map(([memberId, snapshots]) => {
    const ordered = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    return {
      member_id: memberId,
      member_name: last.member_name ?? first.member_name,
      overdosed: periodDelta(ordered, "overdosed"),
      total_xantaken: periodDelta(ordered, "xantaken"),
      average_xantaken: averagePeriodDelta(ordered, "xantaken"),
      adjusted_average_xantaken: adjustedAverageXanax(ordered),
      average_refills: averagePeriodDelta(ordered, "refills"),
      average_useractivity: averagePeriodDelta(ordered, "useractivity"),
      networth: latestNonNullValue(ordered, "networth"),
      total_gymenergy: periodDelta(ordered, "gymenergy"),
      average_gymenergy: averagePeriodDelta(ordered, "gymenergy"),
      average_gymstrength: averagePeriodDelta(ordered, "gymstrength"),
      average_gymspeed: averagePeriodDelta(ordered, "gymspeed"),
      average_gymdefense: averagePeriodDelta(ordered, "gymdefense"),
      average_gymdexterity: averagePeriodDelta(ordered, "gymdexterity"),
      first_snapshot_date: first.snapshot_date,
      last_snapshot_date: last.snapshot_date,
      updated_at: last.captured_at,
    };
  });
}

function summarizeLifestylePeriodRows(rows: LifestylePeriodRow[]) {
  const members = rows.length;
  return {
    members,
    total_overdosed: rows.reduce((total, row) => total + row.overdosed, 0),
    total_xantaken: rows.reduce((total, row) => total + row.total_xantaken, 0),
    average_xantaken: average(rows.map((row) => row.average_xantaken)),
    adjusted_average_xantaken: average(rows.map((row) => row.adjusted_average_xantaken)),
    average_refills: average(rows.map((row) => row.average_refills)),
    average_useractivity: average(rows.map((row) => row.average_useractivity)),
    average_networth: average(
      rows.map((row) => row.networth).filter((value): value is number => value !== null),
    ),
    total_gymenergy: rows.reduce((total, row) => total + row.total_gymenergy, 0),
    average_gymenergy: average(rows.map((row) => row.average_gymenergy)),
    average_gymstrength: average(rows.map((row) => row.average_gymstrength)),
    average_gymspeed: average(rows.map((row) => row.average_gymspeed)),
    average_gymdefense: average(rows.map((row) => row.average_gymdefense)),
    average_gymdexterity: average(rows.map((row) => row.average_gymdexterity)),
    oldest_updated_at: rows.reduce<number | null>((oldest, row) => {
      if (row.updated_at === null) {
        return oldest;
      }
      return oldest === null ? row.updated_at : Math.min(oldest, row.updated_at);
    }, null),
  };
}

function buildDailyChartSeries(
  rows: LifestyleSnapshotRow[],
  memberIds: number[],
  homeMembers: Map<number, LifestyleMemberRow>,
  startDate: string,
  endDate: string,
  metric: LifestyleDailyChartMetric,
) {
  const dates = enumerateDateRange(startDate, endDate);
  const grouped = new Map<number, Map<string, LifestyleSnapshotRow>>();
  for (const row of rows) {
    const snapshotsByDate = grouped.get(row.member_id) ?? new Map<string, LifestyleSnapshotRow>();
    snapshotsByDate.set(row.snapshot_date, row);
    grouped.set(row.member_id, snapshotsByDate);
  }

  return memberIds.map((memberId) => {
    const member = homeMembers.get(memberId);
    const snapshotsByDate = grouped.get(memberId) ?? new Map<string, LifestyleSnapshotRow>();
    return {
      member_id: memberId,
      member_name: member?.name ?? snapshotsByDate.get(endDate)?.member_name ?? null,
      points: dates.map((date) => ({
        date,
        value: dailyChartValue(snapshotsByDate, date, metric),
      })),
    };
  });
}

function dailyChartValue(
  snapshotsByDate: Map<string, LifestyleSnapshotRow>,
  date: string,
  metric: LifestyleDailyChartMetric,
): number | null {
  const snapshot = snapshotsByDate.get(date);
  if (!snapshot) {
    return null;
  }

  if (metric === "networth") {
    return snapshot.networth;
  }

  const previousDate = dateKeyFromMs(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000);
  const previousSnapshot = snapshotsByDate.get(previousDate);
  if (!previousSnapshot) {
    return null;
  }

  return delta(previousSnapshot[metric], snapshot[metric]);
}

function readLifestylePeriod(
  url: URL,
  availableRange: { start_date: string; end_date: string } | null = null,
): {
  start_date: string;
  end_date: string;
  available_start_date: string | null;
  available_end_date: string | null;
  days: number;
  max_days: number;
  capped: boolean;
} {
  const current = currentUtcMonthRange();
  const startDate = clampDateToRange(
    normalizeDateParam(url.searchParams.get("start_date")) ?? current.start_date,
    availableRange,
  );
  const endDate = clampDateToRange(
    normalizeDateParam(url.searchParams.get("end_date")) ?? current.end_date,
    availableRange,
  );
  const normalizedEnd = startDate > endDate ? startDate : endDate;
  const days = Math.max(1, dateDiffDays(startDate, normalizedEnd));
  const capped = days > MAX_LIFESTYLE_PERIOD_DAYS;
  const cappedStartDate = clampDateToRange(
    capped
      ? dateKeyFromMs(Date.parse(`${normalizedEnd}T00:00:00.000Z`) - MAX_LIFESTYLE_PERIOD_DAYS * 86_400_000)
      : startDate,
    availableRange,
  );

  return {
    start_date: cappedStartDate,
    end_date: normalizedEnd,
    available_start_date: availableRange?.start_date ?? null,
    available_end_date: availableRange?.end_date ?? null,
    days: Math.max(1, dateDiffDays(cappedStartDate, normalizedEnd)),
    max_days: MAX_LIFESTYLE_PERIOD_DAYS,
    capped,
  };
}

function clampDateToRange(
  date: string,
  range: { start_date: string; end_date: string } | null,
): string {
  if (!range) {
    return date;
  }

  if (date < range.start_date) {
    return range.start_date;
  }

  if (date > range.end_date) {
    return range.end_date;
  }

  return date;
}

function currentUtcMonthRange(): { start_date: string; end_date: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: now.toISOString().slice(0, 10),
  };
}

function parseLifestyleDailyChartMetric(value: string | null): LifestyleDailyChartMetric | null {
  return value && LIFESTYLE_DAILY_CHART_METRICS.has(value as LifestyleDailyChartMetric)
    ? value as LifestyleDailyChartMetric
    : null;
}

function lifestyleMetricReadyColumn(metric: LifestyleDailyChartMetric): "personal_ready" | "gym_ready" {
  return GYM_CONTRIBUTOR_STAT_KEYS.includes(metric as GymContributorStatKey)
    ? "gym_ready"
    : "personal_ready";
}

function parseLifestyleDailyChartMemberIds(url: URL): number[] {
  const values = [
    ...url.searchParams.getAll("member_id"),
    ...(url.searchParams.get("member_ids")?.split(",") ?? []),
  ];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

function averageDelta(start: number | null, finish: number | null, days: number): number {
  return delta(start, finish) / Math.max(1, days);
}

function averagePeriodDelta(rows: LifestyleSnapshotRow[], key: LifestyleSnapshotNumberKey): number {
  const endpoints = nonNullPeriodEndpoints(rows, key);
  if (!endpoints) {
    return 0;
  }

  return averageDelta(
    endpoints.first[key],
    endpoints.last[key],
    dateDiffDays(endpoints.first.snapshot_date, endpoints.last.snapshot_date),
  );
}

function periodDelta(rows: LifestyleSnapshotRow[], key: LifestyleSnapshotNumberKey): number {
  const endpoints = nonNullPeriodEndpoints(rows, key);
  if (!endpoints) {
    return 0;
  }

  return delta(endpoints.first[key], endpoints.last[key]);
}

function adjustedAverageXanax(rows: LifestyleSnapshotRow[]): number {
  const xanaxEndpoints = nonNullPeriodEndpoints(rows, "xantaken");
  const overdoseEndpoints = nonNullPeriodEndpoints(rows, "overdosed");
  if (!xanaxEndpoints) {
    return 0;
  }

  const days = dateDiffDays(xanaxEndpoints.first.snapshot_date, xanaxEndpoints.last.snapshot_date);
  const overdoses = overdoseEndpoints ? delta(overdoseEndpoints.first.overdosed, overdoseEndpoints.last.overdosed) : 0;
  const adjustedDays = days - overdoses;

  if (adjustedDays <= 0) {
    return 0;
  }

  const adjustedXanax = Math.max(0, delta(xanaxEndpoints.first.xantaken, xanaxEndpoints.last.xantaken) - overdoses);
  return adjustedXanax / adjustedDays;
}

function latestNonNullValue(rows: LifestyleSnapshotRow[], key: LifestyleStatKey): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const value = rows[index][key];
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function nonNullPeriodEndpoints(
  rows: LifestyleSnapshotRow[],
  key: LifestyleSnapshotNumberKey,
): { first: LifestyleSnapshotRow; last: LifestyleSnapshotRow } | null {
  const populatedRows = rows.filter((row) => row[key] !== null);
  if (populatedRows.length === 0) {
    return null;
  }

  return {
    first: populatedRows[0],
    last: populatedRows[populatedRows.length - 1],
  };
}

function delta(start: number | null, finish: number | null): number {
  if (start === null || finish === null) {
    return 0;
  }

  return Math.max(0, Number(finish) - Number(start));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

