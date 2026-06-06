import type { Env } from "../types";
import { nowSeconds } from "../utils";
import type { DailyStatsAttention } from "./model";
import {
  readDailyStatsAttentionCounts,
  readDailyStatsAttentionMembers,
  readLatestPersonalStatsBucketDate,
} from "./queries";

export async function getDailyStatsAttention(env: Env): Promise<DailyStatsAttention> {
  const now = nowSeconds();
  const activeDates = recentCompletedPersonalStatsDates(now);
  const targetDate = activeDates.at(-1) ?? null;
  const latestBucketDate = await readLatestPersonalStatsBucketDate(env);
  const lagDays = targetDate && latestBucketDate
    ? calendarDateDiffDays(latestBucketDate, targetDate)
    : null;
  const rows = await readDailyStatsAttentionMembers(env, activeDates);
  const counts = await readDailyStatsAttentionCounts(env, activeDates);

  return {
    stale_personalstats: counts.stale_personalstats,
    missing_donator_days: counts.missing_donator_days,
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
