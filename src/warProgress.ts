import { originalRankedTarget, WAR_SCORE_INTERVAL_SECONDS } from "../shared/warProgress";
import type { WarProgressResponse, WarScorePoint, WarScoreState } from "../shared/warProgress";
import { HOME_FACTION_ID } from "./constants";
import type { Env, TornRankedWar } from "./types";
import { readWarFromUrl } from "./warRequest";
import { json, nowSeconds } from "./utils";

// Called from the existing ranked-war polling, independently of practical
// tracking. No additional Torn calls and no backfilled/invented history.
export async function recordRankedWarProgress(env: Env, rankedWar: TornRankedWar, observedAt = nowSeconds()): Promise<void> {
  const home = rankedWar.factions?.find((faction) => faction.id === HOME_FACTION_ID);
  const enemy = rankedWar.factions?.find((faction) => faction.id !== HOME_FACTION_ID);
  if (!home || !enemy || !Number.isFinite(rankedWar.start) || rankedWar.start <= 0 ||
    ![rankedWar.target, home.score, enemy.score].every((value) => Number.isFinite(value) && value >= 0)) return;

  const war = await env.DB.prepare(`
    SELECT w.id FROM wars w
    LEFT JOIN war_score_state s ON s.war_id = w.id
    WHERE w.torn_war_id = ? AND COALESCE(w.war_type, 'real') != 'event'
      AND s.ended_at IS NULL
    LIMIT 1
  `).bind(rankedWar.id).first<{ id: number }>();
  if (!war) return;

  const endedAt = rankedWar.end > 0 ? rankedWar.end : null;
  const scoreAt = Math.min(observedAt, endedAt ?? observedAt);
  const original = originalRankedTarget(rankedWar.target, rankedWar.start, scoreAt);
  const statements = [env.DB.prepare(`
    INSERT INTO war_score_state (
      war_id, observed_at, official_start_time, ended_at, home_name, enemy_name,
      home_score, enemy_score, target, original_target
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(war_id) DO UPDATE SET
      observed_at = excluded.observed_at,
      official_start_time = excluded.official_start_time,
      ended_at = excluded.ended_at,
      home_name = excluded.home_name, enemy_name = excluded.enemy_name,
      home_score = excluded.home_score, enemy_score = excluded.enemy_score,
      target = excluded.target,
      original_target = COALESCE(war_score_state.original_target, excluded.original_target)
    WHERE excluded.observed_at >= war_score_state.observed_at AND war_score_state.ended_at IS NULL
  `).bind(war.id, observedAt, rankedWar.start, endedAt, home.name, enemy.name, home.score, enemy.score, rankedWar.target, original)];

  if (scoreAt >= rankedWar.start) {
    const bucket = Math.floor(observedAt / WAR_SCORE_INTERVAL_SECONDS) * WAR_SCORE_INTERVAL_SECONDS;
    statements.push(env.DB.prepare(`
      INSERT INTO war_score_history (war_id, bucket_start, observed_at, home_score, enemy_score, target)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(war_id, bucket_start) DO NOTHING
    `).bind(war.id, bucket, observedAt, home.score, enemy.score, rankedWar.target));
  }
  await env.DB.batch(statements);
}

export async function getWarProgress(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromUrl<WarProgressResponse["war"]>(url, env, {
    select: `id, name, war_type, torn_war_id, official_start_time, official_end_time,
      official_home_score, official_enemy_score, winner_faction_id, enemy_faction_id,
      faction_respect_limit, enemy_target_respect`,
  });
  if (war instanceof Response) return war;
  if (war.war_type === "event") return json({ ok: false, error: "War progress is available for ranked wars only" }, 400);
  const [latest, history] = await Promise.all([
    env.DB.prepare(`SELECT observed_at, official_start_time, ended_at, home_name, enemy_name,
      home_score, enemy_score, target, original_target FROM war_score_state WHERE war_id = ?`)
      .bind(war.id).first<WarScoreState>(),
    env.DB.prepare(`SELECT bucket_start, observed_at, home_score, enemy_score, target
      FROM war_score_history WHERE war_id = ? ORDER BY bucket_start`)
      .bind(war.id).all<WarScorePoint>(),
  ]);
  return json({ ok: true, war, latest, history: history.results ?? [], interval_seconds: WAR_SCORE_INTERVAL_SECONDS } satisfies WarProgressResponse);
}
