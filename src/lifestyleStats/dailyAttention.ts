import type { Env } from "../types";
import { readAuthenticatedUserId } from "../auth";
import { bumpMemberLifestyleCacheVersion, MEMBER_LIFESTYLE_CACHE_VERSION_NAME } from "../cacheVersions";
import { readJsonObject } from "../backend/request";
import { json, nowSeconds } from "../utils";
import { calendarDateDiffDays, recentCompletedPersonalStatsDates, utcDateKey } from "./dates";
import type { DailyStatsAttention } from "./model";
import {
  acceptDailyStatsAttentionIssue,
  readDailyStatsAttentionSummary,
  readLatestPersonalStatsBucketDate,
} from "./queries";

const ATTENTION_CACHE_SECONDS = 5 * 60;
type CachedAttention = { key: string; expiresAt: number; attention: DailyStatsAttention };
// Finished results only: a pending D1 promise belongs to the request that started
// it and never settles if that request is cancelled, so requests must not share one.
const attentionCache = new WeakMap<Env["DB"], CachedAttention>();

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
    nowSeconds(),
    await readAuthenticatedUserId(request, env),
  );
  if (!accepted) {
    return json({ ok: false, error: "This issue has changed or is no longer outstanding. Refresh Data health and try again." }, 409);
  }
  await bumpMemberLifestyleCacheVersion(env);
  return json({ ok: true });
}

export async function getDailyStatsAttention(env: Env, now = nowSeconds()): Promise<DailyStatsAttention> {
  const version = await env.DB.prepare("SELECT last_started FROM sync_state WHERE name = ?")
    .bind(MEMBER_LIFESTYLE_CACHE_VERSION_NAME).first<{ last_started: number | null }>();
  // The UTC date is part of the key: newly overdue gaps must appear at midnight.
  const key = `${utcDateKey(now)}/${version?.last_started ?? 0}`;
  const existing = attentionCache.get(env.DB);
  if (existing?.key === key && existing.expiresAt > now) return existing.attention;

  const entry = await loadCachedAttention(env, now, key);
  attentionCache.set(env.DB, entry);
  return entry.attention;
}

async function loadCachedAttention(env: Env, now: number, key: string): Promise<CachedAttention> {
  // Named edge cache shares results between Worker isolates in the same colo.
  // Cache failure must never make the health endpoint unavailable.
  const cache = typeof caches === "undefined" ? undefined
    : await caches.open("daily-stats-attention-v1").catch(() => undefined);
  const request = new Request(`https://daily-stats-attention.internal/v1/${key}`);
  const hit = await cache?.match(request).catch(() => undefined);
  if (hit) {
    const stored = await hit.json<{ expiresAt: number; attention: DailyStatsAttention }>().catch(() => null);
    if (stored && stored.expiresAt > now) return { key, ...stored };
  }
  const expiresAt = Math.min(now + ATTENTION_CACHE_SECONDS, (Math.floor(now / 86400) + 1) * 86400);
  const attention = await readDailyStatsAttention(env, now);
  await cache?.put(request, new Response(JSON.stringify({ expiresAt, attention }), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${expiresAt - now}` },
  })).catch(() => undefined);
  return { key, expiresAt, attention };
}

async function readDailyStatsAttention(env: Env, now: number): Promise<DailyStatsAttention> {
  const activeDates = recentCompletedPersonalStatsDates(now);
  const targetDate = activeDates.at(-1) ?? null;
  const latestBucketDate = await readLatestPersonalStatsBucketDate(env);
  const lagDays = targetDate && latestBucketDate
    ? calendarDateDiffDays(latestBucketDate, targetDate)
    : null;
  const summary = await readDailyStatsAttentionSummary(env, now);

  return {
    ...summary,
    personalstats_target_date: targetDate,
    latest_personalstats_bucket_date: latestBucketDate,
    personalstats_lag_days: lagDays,
  };
}
