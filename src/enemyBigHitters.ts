import { positiveIntegerOrNull, readJsonObject } from "./backend/request";
import { bumpWarCacheVersion } from "./cacheVersions";
import type { Env, WarRow } from "./types";
import { d1Changes, json } from "./utils";
import { readWarFromScoutingUrl } from "./warRequest";

export const BIG_HITTER_BATTLESTAT_THRESHOLD = 5_000_000_000;

export type EnemyBigHitterRow = {
  war_id: number;
  faction_id: number;
  member_id: number;
  member_name: string;
  created_at: number;
  ff_battlestats: number | null;
  ff_battlestats_updated_at: number | null;
  bsp_battlestats: number | null;
  bsp_battlestats_updated_at: number | null;
  level: number | null;
  position: string | null;
  status_state: string | null;
  last_action_status: string | null;
  last_action_timestamp: number | null;
};

type SeedEnemyBigHittersResult = {
  writeStatements: number;
  changedRows: number;
  seededRows: number;
};

export async function seedEnemyBigHittersForWar(
  env: Env,
  warId: number,
  factionId: number,
): Promise<SeedEnemyBigHittersResult> {
  const result = await env.DB.prepare(
    `
    INSERT INTO enemy_big_hitters (
      war_id,
      faction_id,
      member_id,
      member_name
    )
    SELECT
      ?,
      faction_id,
      member_id,
      name
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND (
        CASE
          WHEN COALESCE(ff_battlestats, 0) >= COALESCE(bsp_battlestats, 0)
            THEN COALESCE(ff_battlestats, 0)
          ELSE COALESCE(bsp_battlestats, 0)
        END
      ) >= ?
    ON CONFLICT(war_id, member_id) DO NOTHING
    `,
  )
    .bind(warId, factionId, BIG_HITTER_BATTLESTAT_THRESHOLD)
    .run();

  const changes = d1Changes(result);
  return { writeStatements: 1, changedRows: changes, seededRows: changes };
}

export async function getEnemyBigHittersForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const bigHitters = await readEnemyBigHitters(env, war.id);
  return jsonEnemyBigHitters(war, bigHitters);
}

export async function addEnemyBigHitterForWar(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const body = await readJsonObject(request);
  const memberId = positiveIntegerOrNull(body.member_id);
  if (memberId === null) {
    return json({ ok: false, error: "A valid member_id is required", code: "INVALID_MEMBER_ID" }, 400);
  }

  const member = (await env.DB.prepare(
    `
    SELECT member_id, faction_id, name
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND member_id = ?
    LIMIT 1
    `,
  )
    .bind(war.enemy_faction_id, memberId)
    .first()) as { member_id: number; faction_id: number; name: string } | null;

  if (!member) {
    return json(
      { ok: false, error: "Enemy member is not in the current scouting roster", code: "MEMBER_NOT_SCOUTED" },
      404,
    );
  }

  await env.DB.prepare(
    `
    INSERT INTO enemy_big_hitters (
      war_id,
      faction_id,
      member_id,
      member_name
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      member_name = excluded.member_name
    `,
  )
    .bind(war.id, member.faction_id, member.member_id, member.name)
    .run();

  await bumpWarCacheVersion(env, war.name);
  const bigHitters = await readEnemyBigHitters(env, war.id);
  return jsonEnemyBigHitters(war, bigHitters);
}

export async function removeEnemyBigHitterForWar(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const body = await readJsonObject(request);
  const memberId = positiveIntegerOrNull(body.member_id);
  if (memberId === null) {
    return json({ ok: false, error: "A valid member_id is required", code: "INVALID_MEMBER_ID" }, 400);
  }

  const result = await env.DB.prepare(
    `
    DELETE FROM enemy_big_hitters
    WHERE war_id = ?
      AND member_id = ?
    `,
  )
    .bind(war.id, memberId)
    .run();

  await bumpWarCacheVersion(env, war.name);
  const bigHitters = await readEnemyBigHitters(env, war.id);
  return json({
    ok: true,
    deleted: d1Changes(result),
    war: enemyBigHitterWarPayload(war),
    big_hitters: bigHitters,
  });
}

async function readEnemyBigHitters(env: Env, warId: number): Promise<EnemyBigHitterRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT
      b.war_id,
      b.faction_id,
      b.member_id,
      b.member_name,
      b.created_at,
      m.ff_battlestats,
      m.ff_battlestats_updated_at,
      m.bsp_battlestats,
      m.bsp_battlestats_updated_at,
      m.level,
      m.position,
      m.status_state,
      m.last_action_status,
      m.last_action_timestamp
    FROM enemy_big_hitters b
    LEFT JOIN enemy_faction_members m
      ON m.member_id = b.member_id
     AND m.faction_id = b.faction_id
    WHERE b.war_id = ?
    ORDER BY
      CASE
        WHEN COALESCE(m.ff_battlestats, 0) >= COALESCE(m.bsp_battlestats, 0)
          THEN COALESCE(m.ff_battlestats, 0)
        ELSE COALESCE(m.bsp_battlestats, 0)
      END DESC,
      b.member_name ASC
    `,
  )
    .bind(warId)
    .all<EnemyBigHitterRow>();

  return rows.results ?? [];
}

function jsonEnemyBigHitters(war: WarRow, bigHitters: EnemyBigHitterRow[]): Response {
  return json({
    ok: true,
    threshold: BIG_HITTER_BATTLESTAT_THRESHOLD,
    war: enemyBigHitterWarPayload(war),
    big_hitters: bigHitters,
  });
}

function enemyBigHitterWarPayload(war: WarRow) {
  return {
    id: war.id,
    name: war.name,
    enemy_faction_id: war.enemy_faction_id,
  };
}
