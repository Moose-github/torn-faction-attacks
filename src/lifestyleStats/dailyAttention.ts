import type { Env } from "../types";
import { nowSeconds } from "../utils";
import {
  MISSING_DONATOR_DAYS_ERROR_CODE,
  OLD_PERSONALSTATS_BUCKET_ERROR_CODE,
} from "./model";
import type { DailyStatsAttention } from "./model";

export async function getDailyStatsAttention(env: Env): Promise<DailyStatsAttention> {
  const now = nowSeconds();
  const activeDates = recentCompletedPersonalStatsDates(now);
  const targetDate = activeDates.at(-1) ?? null;
  const activeDatePlaceholders = activeDates.map(() => "?").join(",");
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
  const latestBucketDate = latestBucketRow?.snapshot_date ?? null;
  const lagDays = targetDate && latestBucketDate
    ? calendarDateDiffDays(latestBucketDate, targetDate)
    : null;

  const rows = ((await env.DB.prepare(
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
    .all()).results ?? []) as DailyStatsAttention["affected_members"];

  const counts = (await env.DB.prepare(
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
    .first()) as { stale_personalstats: number | null; missing_donator_days: number | null } | null;

  return {
    stale_personalstats: counts?.stale_personalstats ?? 0,
    missing_donator_days: counts?.missing_donator_days ?? 0,
    personalstats_target_date: targetDate,
    latest_personalstats_bucket_date: latestBucketDate,
    personalstats_lag_days: lagDays,
    affected_members: rows,
  };
}

function recentCompletedPersonalStatsDates(timestamp: number): string[] {
  const date = new Date(timestamp * 1000);
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return [
    dateKeyFromMs(todayStart - 2 * 86_400_000),
    dateKeyFromMs(todayStart - 86_400_000),
  ];
}

function calendarDateDiffDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function dateKeyFromMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
