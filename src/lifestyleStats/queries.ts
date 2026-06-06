import type { Env } from "../types";
import {
  MISSING_DONATOR_DAYS_ERROR_CODE,
  OLD_PERSONALSTATS_BUCKET_ERROR_CODE,
} from "./model";
import type { DailyStatsAttention } from "./model";

export type DailyStatsAttentionCounts = Pick<
  DailyStatsAttention,
  "missing_donator_days" | "stale_personalstats"
>;

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
