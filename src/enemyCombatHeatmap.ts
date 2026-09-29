import { POSITIVE_RESULTS_SQL } from "./constants";
import { OUTGOING_ACTION_WINDOW_SQL, RELEVANT_DEFEND_SQL } from "./sql";
import type { Env, WarRow } from "./types";
import { json, nowSeconds } from "./utils";
import { readWarFromUrl } from "./warRequest";

type EnemyCombatBucket = {
  war_id: number;
  member_id: number;
  member_name: string | null;
  bucket_start: number;
  attacks_total: number;
  attacks_successful: number;
  respect_gained: number;
  outside_hits: number;
  defends_lost: number;
  respect_lost: number;
};

export async function getWarEnemyCombatHeatmap(url: URL, env: Env): Promise<Response> {
  try {
    const windowMode = url.searchParams.get("window") ?? "practical";
    if (windowMode !== "practical" && windowMode !== "official") {
      return json({ ok: false, error: "Invalid activity window", code: "INVALID_ACTIVITY_WINDOW" }, 400);
    }
    const war = await readWarFromUrl<WarRow>(url, env);
    if (war instanceof Response) return war;

    const bucketSeconds = 15 * 60;
    const start = windowMode === "official"
      ? war.official_start_time ?? war.practical_start_time
      : war.practical_start_time;
    const finish = (windowMode === "official" ? war.official_end_time : war.practical_finish_time) ?? nowSeconds();
    const timeBuckets: number[] = [];
    if (finish >= start) {
      for (let at = Math.floor(start / bucketSeconds) * bucketSeconds; at <= finish; at += bucketSeconds) {
        timeBuckets.push(at);
      }
    }
    const windowSql = windowMode === "practical" ? OUTGOING_ACTION_WINDOW_SQL : `
      a.started >= COALESCE(w.official_start_time, w.practical_start_time)
      AND (w.official_end_time IS NULL OR COALESCE(a.ended, a.started) <= w.official_end_time)
    `;
    const anonymousSql = "a.attacker_id IS NULL OR a.is_stealthed = 1";
    const rows = war.war_type === "event" || war.enemy_faction_id === null || timeBuckets.length === 0
      ? []
      : (await env.DB.prepare(`
        SELECT a.war_id,
          CASE WHEN ${anonymousSql} THEN 0 ELSE a.attacker_id END AS member_id,
          CASE WHEN ${anonymousSql} THEN 'Stealthed' ELSE MAX(a.attacker_name) END AS member_name,
          CAST(a.started / ${bucketSeconds} AS INTEGER) * ${bucketSeconds} AS bucket_start,
          COUNT(*) AS attacks_total,
          SUM(CASE WHEN a.result IN (${POSITIVE_RESULTS_SQL}) THEN 1 ELSE 0 END) AS attacks_successful,
          COALESCE(SUM(CASE WHEN a.result IN (${POSITIVE_RESULTS_SQL}) THEN a.respect_gain ELSE 0 END), 0) AS respect_gained,
          0 AS outside_hits, 0 AS defends_lost, 0 AS respect_lost
        FROM attacks a JOIN wars w ON w.id = a.war_id
        WHERE a.war_id = ? AND ${RELEVANT_DEFEND_SQL}
          AND (${windowSql})
          AND a.started >= ? AND COALESCE(a.ended, a.started) <= ?
        GROUP BY member_id, bucket_start
        ORDER BY bucket_start, member_id
      `).bind(war.id, start, finish).all<EnemyCombatBucket>()).results ?? [];

    const members = new Map<number, {
      member_id: number; member_name: string | null; attacks_total: number;
      attacks_vs_enemy_successful: number; respect_gained: number;
      outside_hits: number; defends_total: number; defends_won: number; defends_other: number; respect_lost: number;
    }>();
    for (const bucket of rows) {
      const member = members.get(bucket.member_id) ?? {
        member_id: bucket.member_id, member_name: bucket.member_name,
        attacks_total: 0, attacks_vs_enemy_successful: 0, respect_gained: 0,
        outside_hits: 0, defends_total: 0, defends_won: 0, defends_other: 0, respect_lost: 0,
      };
      member.member_name = member.member_name ?? bucket.member_name;
      member.attacks_total += bucket.attacks_total;
      member.attacks_vs_enemy_successful += bucket.attacks_successful;
      member.respect_gained += bucket.respect_gained;
      members.set(member.member_id, member);
    }
    return json({
      ok: true, window: windowMode, bucket_minutes: 15,
      war: {
        id: war.id, name: war.name, enemy_faction_id: war.enemy_faction_id, war_type: war.war_type,
        practical_start_time: war.practical_start_time, practical_finish_time: war.practical_finish_time,
        official_start_time: war.official_start_time, official_end_time: war.official_end_time,
      },
      time_buckets: timeBuckets,
      members: [...members.values()].sort((a, b) =>
        Number(a.member_id === 0) - Number(b.member_id === 0) ||
        b.attacks_vs_enemy_successful - a.attacks_vs_enemy_successful ||
        b.respect_gained - a.respect_gained || a.member_id - b.member_id),
      buckets: rows,
    });
  } catch (error: any) {
    return json({ ok: false, error: error?.message ?? String(error), code: "INTERNAL_ERROR" }, 500);
  }
}
