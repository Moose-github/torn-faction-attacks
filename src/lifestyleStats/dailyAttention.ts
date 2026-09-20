import type { Env } from "../types";
import { readAuthenticatedUserId } from "../auth";
import { readJsonObject } from "../backend/request";
import { json, nowSeconds } from "../utils";
import type { DailyStatsAttention } from "./model";
import {
  acceptDailyStatsAttentionIssue,
  readDailyStatsAttentionCounts,
  readDailyStatsAttentionMembers,
  readLatestPersonalStatsBucketDate,
} from "./queries";

export async function acceptDailyStatsIssueFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const { member_id: memberId, snapshot_date: snapshotDate, status, error } = body;
  if (typeof memberId !== "number" || !Number.isSafeInteger(memberId) || memberId <= 0
    || typeof snapshotDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)
    || !Number.isFinite(Date.parse(`${snapshotDate}T00:00:00Z`))
    || new Date(`${snapshotDate}T00:00:00Z`).toISOString().slice(0, 10) !== snapshotDate
    || (status !== "pending" && status !== "completed" && status !== "retry_expired" && status !== "failed")
    || (error !== null && typeof error !== "string")) {
    return json({ ok: false, error: "A valid member, snapshot date, status and error are required." }, 400);
  }
  const accepted = await acceptDailyStatsAttentionIssue(
    env, { member_id: memberId, snapshot_date: snapshotDate, status, error },
    recentCompletedPersonalStatsDates(nowSeconds()),
    await readAuthenticatedUserId(request, env),
  );
  if (!accepted) {
    return json({ ok: false, error: "This issue has changed or is no longer outstanding. Refresh Data health and try again." }, 409);
  }
  return json({ ok: true });
}

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
