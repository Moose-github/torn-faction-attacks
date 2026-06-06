import { HOME_FACTION_ID } from "../constants";
import type { Env } from "../types";
import {
  MISSING_DONATOR_DAYS_ERROR_CODE,
  OLD_PERSONALSTATS_BUCKET_ERROR_CODE,
} from "./model";
import type {
  DailyStatsAttention,
  LifestyleMemberRow,
  LifestyleSnapshotReadyFilter,
  LifestyleSnapshotRow,
} from "./model";

const LIFESTYLE_SNAPSHOT_COLUMNS = `
  snapshots.member_id,
  snapshots.snapshot_date,
  snapshots.member_name,
  snapshots.xantaken,
  snapshots.overdosed,
  snapshots.refills,
  snapshots.useractivity,
  snapshots.networth,
  snapshots.daysbeendonator,
  snapshots.xantaken_timestamp,
  snapshots.overdosed_timestamp,
  snapshots.refills_timestamp,
  snapshots.useractivity_timestamp,
  snapshots.networth_timestamp,
  snapshots.daysbeendonator_timestamp,
  snapshots.personalstats_bucket_date,
  snapshots.personalstats_requested_at,
  snapshots.personalstats_key_source,
  snapshots.gymenergy,
  snapshots.gymstrength,
  snapshots.gymspeed,
  snapshots.gymdefense,
  snapshots.gymdexterity,
  snapshots.personal_captured_at,
  snapshots.gym_captured_at,
  snapshots.gym_error,
  snapshots.personal_ready,
  snapshots.gym_ready,
  snapshots.fully_ready,
  snapshots.captured_at,
  snapshots.validation_error
`;

export type DailyStatsAttentionCounts = Pick<
  DailyStatsAttention,
  "missing_donator_days" | "stale_personalstats"
>;

export async function readCompleteLifestyleSnapshotDateRange(
  env: Env,
  readyFilter: LifestyleSnapshotReadyFilter,
): Promise<{ start_date: string; end_date: string } | null> {
  const readyCondition = lifestyleSnapshotReadyCondition("snapshots", readyFilter);
  const row = (await env.DB.prepare(
    `
    SELECT
      MIN(candidate_dates.snapshot_date) AS start_date,
      MAX(candidate_dates.snapshot_date) AS end_date
    FROM (
      SELECT DISTINCT snapshot_date
      FROM member_lifestyle_stat_snapshots
    ) candidate_dates
    WHERE NOT EXISTS (
      SELECT 1
      FROM home_faction_members members
      LEFT JOIN member_lifestyle_stat_snapshots snapshots
        ON snapshots.member_id = members.member_id
       AND snapshots.snapshot_date = candidate_dates.snapshot_date
       AND ${readyCondition}
      WHERE members.faction_id = ?
        AND members.is_current = 1
        AND members.report_exempt = 0
        AND snapshots.member_id IS NULL
    )
    `,
  ).bind(HOME_FACTION_ID).first()) as { start_date: string | null; end_date: string | null } | null;

  if (!row?.start_date || !row.end_date) {
    return null;
  }

  return {
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

export async function readLifestylePeriodSnapshotRows(
  env: Env,
  startDate: string,
  endDate: string,
): Promise<LifestyleSnapshotRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT ${LIFESTYLE_SNAPSHOT_COLUMNS}
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members
      ON home_faction_members.member_id = snapshots.member_id
     AND home_faction_members.is_current = 1
     AND home_faction_members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND snapshots.fully_ready = 1
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
    `,
  )
    .bind(startDate, endDate)
    .all<LifestyleSnapshotRow>();

  return rows.results ?? [];
}

export async function readLifestyleDailyChartSnapshotRows(
  env: Env,
  startDate: string,
  endDate: string,
  memberIds: number[],
  readyColumn: "personal_ready" | "gym_ready",
): Promise<LifestyleSnapshotRow[]> {
  if (memberIds.length === 0) {
    return [];
  }

  const placeholders = memberIds.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `
    SELECT ${LIFESTYLE_SNAPSHOT_COLUMNS}
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.snapshot_date BETWEEN ? AND ?
      AND snapshots.member_id IN (${placeholders})
      AND snapshots.${readyColumn} = 1
    ORDER BY snapshots.member_id ASC, snapshots.snapshot_date ASC
    `,
  )
    .bind(startDate, endDate, ...memberIds)
    .all<LifestyleSnapshotRow>();

  return rows.results ?? [];
}

function lifestyleSnapshotReadyCondition(tableAlias: string, readyFilter: LifestyleSnapshotReadyFilter): string {
  if (readyFilter === "any_ready") {
    return `(${tableAlias}.personal_ready = 1 OR ${tableAlias}.gym_ready = 1)`;
  }

  return `${tableAlias}.${readyFilter} = 1`;
}

export async function readHomeMembersById(
  env: Env,
  options: { includeReportExempt?: boolean } = {},
): Promise<Map<number, LifestyleMemberRow>> {
  const rows = await env.DB.prepare(
    `
    SELECT member_id, name, level, position, updated_at AS personal_captured_at
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
      AND (? = 1 OR report_exempt = 0)
    `,
  )
    .bind(HOME_FACTION_ID, options.includeReportExempt ? 1 : 0)
    .all<LifestyleMemberRow>();

  return new Map((rows.results ?? []).map((row) => [row.member_id, row]));
}

export async function readLatestPersonalStatsBucketDate(env: Env): Promise<string | null> {
  const latestBucketRow = (await env.DB.prepare(
    `
    SELECT snapshots.snapshot_date AS snapshot_date
    FROM member_lifestyle_stat_snapshots snapshots
    JOIN home_faction_members members
      ON members.member_id = snapshots.member_id
     AND members.is_current = 1
     AND members.report_exempt = 0
    WHERE snapshots.personal_ready = 1
    ORDER BY snapshots.snapshot_date DESC
    LIMIT 1
    `,
  ).first()) as { snapshot_date: string | null } | null;

  return latestBucketRow?.snapshot_date ?? null;
}

export async function readDailyStatsAttentionMembers(
  env: Env,
  activeDates: string[],
): Promise<DailyStatsAttention["affected_members"]> {
  const activeDatePlaceholders = activeDates.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `
    SELECT
      members.member_id,
      COALESCE(stats.member_name, members.name) AS member_name,
      stats.error AS error,
      stats.updated_at AS updated_at
    FROM home_faction_members members
    JOIN member_personal_stats_recent stats
      ON stats.member_id = members.member_id
    WHERE members.is_current = 1
      AND members.report_exempt = 0
      AND (
        stats.status = 'retry_expired'
        OR (
          stats.snapshot_date NOT IN (${activeDatePlaceholders})
          AND (
            stats.error LIKE ?
            OR (
              stats.error IS NOT NULL
              AND stats.error NOT LIKE ?
              AND stats.error NOT LIKE ?
            )
          )
        )
      )
    ORDER BY stats.snapshot_date ASC, members.name ASC
    LIMIT 12
    `,
  )
    .bind(
      ...activeDates,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
      `${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}%`,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
    )
    .all<DailyStatsAttention["affected_members"][number]>();

  return rows.results ?? [];
}

export async function readDailyStatsAttentionCounts(
  env: Env,
  activeDates: string[],
): Promise<DailyStatsAttentionCounts> {
  const activeDatePlaceholders = activeDates.map(() => "?").join(",");
  const counts = await env.DB.prepare(
    `
    SELECT
      SUM(CASE
        WHEN stats.status = 'retry_expired'
          OR (
            stats.snapshot_date NOT IN (${activeDatePlaceholders})
            AND stats.error IS NOT NULL
            AND stats.error NOT LIKE ?
            AND stats.error NOT LIKE ?
          )
        THEN 1
        ELSE 0
      END) AS stale_personalstats,
      SUM(CASE
        WHEN stats.snapshot_date NOT IN (${activeDatePlaceholders})
          AND stats.error LIKE ?
        THEN 1
        ELSE 0
      END) AS missing_donator_days
    FROM home_faction_members members
    JOIN member_personal_stats_recent stats
      ON stats.member_id = members.member_id
    WHERE members.is_current = 1
      AND members.report_exempt = 0
    `,
  )
    .bind(
      ...activeDates,
      `${OLD_PERSONALSTATS_BUCKET_ERROR_CODE}%`,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
      ...activeDates,
      `${MISSING_DONATOR_DAYS_ERROR_CODE}%`,
    )
    .first<{
      stale_personalstats: number | null;
      missing_donator_days: number | null;
    }>();

  return {
    stale_personalstats: counts?.stale_personalstats ?? 0,
    missing_donator_days: counts?.missing_donator_days ?? 0,
  };
}
