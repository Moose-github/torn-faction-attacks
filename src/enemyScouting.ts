import { FFSCOUTER_STATS_API_URL, TORN_FACTION_API_BASE_URL } from "./constants";
import { Env, TornFactionMember, TornFactionMembersResponse, WarRow } from "./types";
import { boolToInt, json } from "./utils";

const FFSCOUTER_BATCH_SIZE = 100;

type EnemyFactionMemberRow = {
  member_id: number;
  faction_id: number;
  faction_name: string | null;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number | null;
  estimated_stats: number | null;
  estimated_stats_updated_at: number | null;
  updated_at: number;
};

type StatEstimate = {
  stats: number;
  updatedAt: number | null;
};

export async function getEnemyScoutingForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const scouting = await readEnemyScouting(env, enemyFactionId);
  return jsonEnemyScouting(war, scouting, false);
}

export async function refreshEnemyScoutingForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const existing = await readEnemyScouting(env, enemyFactionId);
  if (existing.length === 0) {
    await replaceEnemyFactionMembers(env, enemyFactionId);
  } else {
    await refreshMissingStatEstimates(env, existing);
  }

  const scouting = await readEnemyScouting(env, enemyFactionId);
  return jsonEnemyScouting(war, scouting, true);
}

async function readWarFromScoutingUrl(url: URL, env: Env): Promise<WarRow | Response> {
  const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT *
    FROM wars
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as WarRow | null;

  if (!war) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }

  if (war.enemy_faction_id === null) {
    return json(
      { ok: false, error: "War does not have an enemy faction ID", code: "MISSING_ENEMY_FACTION" },
      400,
    );
  }

  return war;
}

async function readEnemyScouting(
  env: Env,
  factionId: number,
): Promise<EnemyFactionMemberRow[]> {
  const staleRows = (await env.DB.prepare(
    `
    SELECT faction_id
    FROM enemy_faction_members
    WHERE faction_id != ?
    LIMIT 1
    `,
  )
    .bind(factionId)
    .all()).results ?? [];

  if (staleRows.length > 0) {
    await env.DB.prepare(`DELETE FROM enemy_faction_members`).run();
    return [];
  }

  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
    ORDER BY estimated_stats DESC NULLS LAST, level DESC, name ASC
    `,
  )
    .bind(factionId)
    .all();

  return (rows.results ?? []) as EnemyFactionMemberRow[];
}

async function replaceEnemyFactionMembers(env: Env, factionId: number): Promise<void> {
  const members = await fetchTornFactionMembers(env, factionId);
  await env.DB.prepare(`DELETE FROM enemy_faction_members`).run();

  if (members.length === 0) {
    return;
  }

  const factionName = null;
  await env.DB.batch(
    members.map((member) =>
      env.DB.prepare(
        `
        INSERT INTO enemy_faction_members (
          member_id,
          faction_id,
          faction_name,
          name,
          level,
          position,
          days_in_faction,
          is_revivable,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          faction_name = excluded.faction_name,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          updated_at = excluded.updated_at
        `,
      ).bind(
        member.id,
        factionId,
        factionName,
        member.name,
        finiteNumber(member.level),
        member.position ?? null,
        finiteNumber(member.days_in_faction),
        boolToInt(member.is_revivable ?? false),
      ),
    ),
  );

  const rows = await readEnemyScouting(env, factionId);
  await refreshMissingStatEstimates(env, rows);
}

async function refreshMissingStatEstimates(
  env: Env,
  rows: EnemyFactionMemberRow[],
): Promise<void> {
  if (!env.FFSCOUTER_API_KEY) {
    return;
  }

  const missingIds = rows
    .filter((row) => row.estimated_stats === null)
    .map((row) => row.member_id);

  for (const ids of chunks(missingIds, FFSCOUTER_BATCH_SIZE)) {
    const estimates = await fetchFfscouterStats(env, ids).catch((err) => {
      console.warn("FFScouter stats fetch failed:", err?.message || err);
      return new Map<number, StatEstimate>();
    });

    const statements = Array.from(estimates.entries()).map(([memberId, estimate]) =>
      env.DB.prepare(
        `
        UPDATE enemy_faction_members
        SET estimated_stats = ?,
            estimated_stats_updated_at = COALESCE(?, unixepoch()),
            updated_at = unixepoch()
        WHERE member_id = ?
        `,
      ).bind(estimate.stats, estimate.updatedAt, memberId),
    );

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }
  }
}

async function fetchTornFactionMembers(env: Env, factionId: number): Promise<TornFactionMember[]> {
  const url = new URL(`${TORN_FACTION_API_BASE_URL}/${factionId}/members`);
  url.searchParams.set("striptags", "false");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn faction members API error: ${response.status}`);
  }

  const data = (await response.json()) as TornFactionMembersResponse;
  return normalizeMembers(data.members);
}

async function fetchFfscouterStats(
  env: Env,
  memberIds: number[],
): Promise<Map<number, StatEstimate>> {
  if (memberIds.length === 0 || !env.FFSCOUTER_API_KEY) {
    return new Map();
  }

  const url = new URL(FFSCOUTER_STATS_API_URL);
  url.searchParams.set("key", env.FFSCOUTER_API_KEY);
  url.searchParams.set("targets", memberIds.join(","));

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`FFScouter API error: ${response.status}`);
  }

  return extractStatEstimates(await response.json());
}

function extractStatEstimates(data: any): Map<number, StatEstimate> {
  const estimates = new Map<number, StatEstimate>();
  const containers = [data?.stats, data?.data, data?.results, data];

  for (const container of containers) {
    if (!container) continue;

    if (Array.isArray(container)) {
      for (const item of container) {
        addEstimate(estimates, item?.id ?? item?.player_id ?? item?.target, item);
      }
      continue;
    }

    if (typeof container === "object") {
      for (const [key, value] of Object.entries(container)) {
        addEstimate(estimates, key, value);
      }
    }
  }

  return estimates;
}

function addEstimate(estimates: Map<number, StatEstimate>, idValue: unknown, source: any) {
  const memberId = Number(idValue);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return;
  }

  const stats =
    source && typeof source === "object"
      ? firstFiniteNumber(
          source.total,
          source.total_stats,
          source.bs_estimate,
          source.estimated_stats,
          source.battle_stats,
          source.stats,
          source.value,
        )
      : finiteNumber(source);

  if (stats !== null) {
    estimates.set(memberId, {
      stats,
      updatedAt: firstFiniteNumber(source?.last_updated, source?.updated_at),
    });
  }
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMembers(
  members: TornFactionMembersResponse["members"],
): TornFactionMember[] {
  if (!members) {
    return [];
  }

  return Array.isArray(members) ? members : Object.values(members);
}

function jsonEnemyScouting(
  war: WarRow,
  rows: EnemyFactionMemberRow[],
  refreshed: boolean,
): Response {
  const statsRows = rows.filter((row) => row.estimated_stats !== null);
  const averageLevel =
    rows.length === 0
      ? 0
      : rows.reduce((total, row) => total + Number(row.level ?? 0), 0) / rows.length;
  const averageEstimatedStats =
    statsRows.length === 0
      ? null
      : statsRows.reduce((total, row) => total + Number(row.estimated_stats ?? 0), 0) /
        statsRows.length;

  return json({
    ok: true,
    refreshed,
    war: {
      id: war.id,
      name: war.name,
      enemy_faction_id: war.enemy_faction_id,
    },
    summary: {
      members_loaded: rows.length,
      average_level: averageLevel,
      average_estimated_stats: averageEstimatedStats,
      missing_estimated_stats: rows.length - statsRows.length,
      stats_available: statsRows.length,
    },
    members: rows,
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
