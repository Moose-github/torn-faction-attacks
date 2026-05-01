import {
  HOME_FACTION_ID,
  POSITIVE_ATTACK_RESULTS,
  POSITIVE_RESULTS_SQL,
  WAR_TYPES,
} from "./constants";
import { getWarChainBonuses } from "./reports";
import {
  DEFENSE_ACTION_WINDOW_SQL,
  OUTGOING_ACTION_WINDOW_SQL,
  WAR_SELECT_COLUMNS,
  WAR_SELECT_COLUMNS_WITH_ALIAS,
} from "./sql";
import { Env, WarRow, WarSummaryRow } from "./types";
import { json, parseLimit } from "./utils";

export async function listWars(url: URL, env: Env): Promise<Response> {
  try {
    const warType = parseWarTypeQuery(url);
    if (warType instanceof Response) {
      return warType;
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        ${WAR_SELECT_COLUMNS_WITH_ALIAS},
        COALESCE(ws.faction_attacks, 0) AS faction_attacks,
        COALESCE(ws.enemy_attacks, 0) AS enemy_attacks,
        COALESCE(ws.outside_hits_outgoing, 0) AS outside_hits_outgoing,
        COALESCE(ws.total_respect_gain, 0) AS total_respect_gain,
        COALESCE(ws.total_respect_lost, 0) AS total_respect_lost,
        COALESCE(ws.unique_attackers, 0) AS unique_attackers,
        ws.first_attack_at,
        ws.last_attack_at,
        ws.updated_at AS summary_updated_at
      FROM wars w
      LEFT JOIN war_summary ws ON ws.war_id = w.id
      WHERE (? IS NULL OR COALESCE(w.war_type, 'real') = ?)
      ORDER BY w.practical_start_time DESC
      `,
    )
      .bind(warType, warType)
      .all();

    return json({ ok: true, wars: rows.results ?? [] });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWar(url: URL, env: Env): Promise<Response> {
  try {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const war = (await env.DB.prepare(
      `
      SELECT
        ${WAR_SELECT_COLUMNS}
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

    const summary = (await env.DB.prepare(
      `
      SELECT *
      FROM war_summary
      WHERE war_id = ?
      LIMIT 1
      `,
    )
      .bind(war.id)
      .first()) as WarSummaryRow | null;

    const memberStats = await env.DB.prepare(
      `
      SELECT
        wms.*,
        (
          SELECT AVG(a.m_fair_fight)
          FROM attacks a
          JOIN wars w ON w.id = a.war_id
          WHERE a.war_id = wms.war_id
            AND a.attacker_id = wms.member_id
            AND a.attacker_faction_id = ${HOME_FACTION_ID}
            AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
            AND ${OUTGOING_ACTION_WINDOW_SQL}
        ) AS average_fair_fight,
        CASE
          WHEN ? IS NOT NULL AND ? > 0
          THEN wms.enemy_respect_gained * 100.0 / ?
          ELSE NULL
        END AS member_respect_limit_percent
      FROM war_member_stats wms
      WHERE wms.war_id = ?
      ORDER BY enemy_respect_gained DESC, enemy_attacks_successful DESC, enemy_attacks_total DESC
      `,
    )
      .bind(war.member_respect_limit, war.member_respect_limit, war.member_respect_limit, war.id)
      .all();
    const chainBonuses = await getWarChainBonuses(env, war.id, 5);

    return json({
      ok: true,
      war,
      summary,
      members: memberStats.results ?? [],
      chain_bonuses: chainBonuses,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarAttacks(url: URL, env: Env): Promise<Response> {
  try {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const limit = parseLimit(url.searchParams.get("limit"), 100, 250);

    const war = (await env.DB.prepare(
      `
      SELECT
        ${WAR_SELECT_COLUMNS}
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

    const attacks = await env.DB.prepare(
      `
      SELECT *
      FROM attacks
      WHERE war_id = ?
      ORDER BY started DESC
      LIMIT ?
      `,
    )
      .bind(war.id, limit)
      .all();

    return json({
      ok: true,
      war,
      paging: {
        limit,
        returned: (attacks.results ?? []).length,
      },
      attacks: attacks.results ?? [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarMemberAttacks(url: URL, env: Env): Promise<Response> {
  try {
    const parts = url.pathname.split("/");
    const name = decodeURIComponent(parts[3] ?? "").trim();
    const memberId = Number(parts[5]);

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    if (!Number.isInteger(memberId) || memberId <= 0) {
      return json({ ok: false, error: "Invalid member id", code: "INVALID_MEMBER_ID" }, 400);
    }

    const war = (await env.DB.prepare(
      `
      SELECT id, name, practical_start_time, practical_finish_time, official_start_time, official_end_time, status, enemy_faction_id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as {
      id: number;
      name: string;
      practical_start_time: number;
      practical_finish_time: number | null;
      official_start_time: number | null;
      official_end_time: number | null;
      status: string;
      enemy_faction_id: number | null;
    } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        a.id,
        a.started,
        a.ended,
        a.attacker_id,
        a.attacker_name,
        a.attacker_faction_id,
        a.attacker_faction_name,
        a.defender_id,
        a.defender_name,
        a.defender_faction_id,
        a.defender_faction_name,
        a.result,
        a.respect_gain,
        a.respect_loss,
        a.m_retaliation
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND (
          (
            a.attacker_id = ?
            AND ${OUTGOING_ACTION_WINDOW_SQL}
          )
          OR (
            a.defender_id = ?
            AND ${DEFENSE_ACTION_WINDOW_SQL}
          )
      )
      ORDER BY a.started DESC
      `,
    )
      .bind(war.id, memberId, memberId)
      .all();

    const attacks = (rows.results ?? []).map((attack: any) => ({
      ...attack,
      classification: classifyMemberAttack(attack, memberId, war.enemy_faction_id),
    }));

    return json({
      ok: true,
      war: {
        id: war.id,
        name: war.name,
        enemy_faction_id: war.enemy_faction_id,
      },
      member_id: memberId,
      paging: {
        returned: attacks.length,
      },
      attacks,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarActivity(url: URL, env: Env): Promise<Response> {
  try {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const bucketMinutes = parseBucketMinutes(url.searchParams.get("bucket_minutes"));
    const bucketSeconds = bucketMinutes * 60;

    const war = (await env.DB.prepare(
      `
      SELECT id, name, enemy_faction_id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as { id: number; name: string; enemy_faction_id: number | null } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        SUM(CASE
          WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
           AND (? IS NULL OR a.defender_faction_id = ?)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
           AND ${OUTGOING_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS enemy_success,
        SUM(CASE
          WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
           AND (? IS NULL OR a.defender_faction_id = ?)
           AND a.result = 'Assist'
           AND ${OUTGOING_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS enemy_assist,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND a.attacker_faction_id = ${HOME_FACTION_ID}
           AND ${OUTGOING_ACTION_WINDOW_SQL}
           AND (a.defender_faction_id IS NULL OR a.defender_faction_id != ?)
           AND NOT (
             a.defender_faction_id = ${HOME_FACTION_ID}
             AND a.result = 'Hospitalized'
           )
          THEN 1
          ELSE 0
        END) AS outside,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND a.attacker_faction_id = ?
           AND a.defender_faction_id = ${HOME_FACTION_ID}
           AND a.result IN (${POSITIVE_RESULTS_SQL})
           AND ${DEFENSE_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS defend_lost,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND a.attacker_faction_id = ?
           AND a.defender_faction_id = ${HOME_FACTION_ID}
           AND (a.result NOT IN (${POSITIVE_RESULTS_SQL}) OR a.result IS NULL)
           AND ${DEFENSE_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS defend_won
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
      `,
    )
      .bind(
        bucketSeconds,
        bucketSeconds,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.id,
      )
      .all();

    const buckets = (rows.results ?? []).map((row: any) => ({
      bucket_start: row.bucket_start,
      enemy_success: Number(row.enemy_success ?? 0),
      enemy_assist: Number(row.enemy_assist ?? 0),
      outside: Number(row.outside ?? 0),
      defend_lost: Number(row.defend_lost ?? 0),
      defend_won: Number(row.defend_won ?? 0),
    }));

    return json({
      ok: true,
      war: {
        id: war.id,
        name: war.name,
        enemy_faction_id: war.enemy_faction_id,
      },
      bucket_minutes: bucketMinutes,
      buckets,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getOverallStats(url: URL, env: Env): Promise<Response> {
  const warType = parseWarTypeQuery(url);
  if (warType instanceof Response) {
    return warType;
  }

  const overall = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_wars,
      COALESCE(SUM(ws.faction_attacks), 0) AS faction_attacks,
      COALESCE(SUM(ws.enemy_attacks), 0) AS enemy_attacks,
      COALESCE(SUM(ws.outside_hits_outgoing), 0) AS outside_hits_outgoing,
      COALESCE(SUM(ws.total_respect_gain), 0) AS total_respect_gain,
      COALESCE(SUM(ws.total_respect_lost), 0) AS total_respect_lost,
      MAX(ws.last_attack_at) AS latest_attack_started
    FROM war_summary ws
    JOIN wars w ON w.id = ws.war_id
    WHERE (? IS NULL OR COALESCE(w.war_type, 'real') = ?)
    `,
  )
    .bind(warType, warType)
    .first();

  const members = await env.DB.prepare(
    `
    SELECT
      wms.member_id,
      MAX(wms.member_name) AS member_name,
      COUNT(DISTINCT wms.war_id) AS wars_participated,
      COALESCE(SUM(wms.enemy_attacks_total), 0) AS enemy_attacks_total,
      COALESCE(SUM(wms.enemy_attacks_successful), 0) AS enemy_attacks_successful,
      COALESCE(SUM(wms.enemy_respect_gained), 0) AS enemy_respect_gained,
      COALESCE(SUM(wms.enemy_assists), 0) AS enemy_assists,
      COALESCE(SUM(wms.enemy_hospitalizations), 0) AS enemy_hospitalizations,
      COALESCE(SUM(wms.enemy_mugs), 0) AS enemy_mugs,
      COALESCE(SUM(wms.enemy_retaliations), 0) AS enemy_retaliations,
      COALESCE(SUM(wms.outside_attacks), 0) AS outside_attacks,
      COALESCE(SUM(wms.friendly_hospitals), 0) AS friendly_hospitals,
      COALESCE(SUM(wms.defends_total), 0) AS defends_total,
      COALESCE(SUM(wms.defends_won), 0) AS defends_won,
      COALESCE(SUM(wms.respect_lost), 0) AS respect_lost,
      MIN(wms.first_action_at) AS first_seen_at,
      MAX(wms.last_action_at) AS last_seen_at
    FROM war_member_stats wms
    JOIN wars w ON w.id = wms.war_id
    WHERE (? IS NULL OR COALESCE(w.war_type, 'real') = ?)
    GROUP BY wms.member_id
    ORDER BY enemy_respect_gained DESC, enemy_attacks_successful DESC, enemy_attacks_total DESC
    `,
  )
    .bind(warType, warType)
    .all();

  const memberRows = members.results ?? [];

  return json({
    ok: true,
    war_type: warType,
    overall,
    members: memberRows,
  });
}

function parseBucketMinutes(value: string | null): number {
  const parsed = Number(value ?? 15);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 15;
  }

  return Math.min(parsed, 120);
}

function classifyMemberAttack(
  attack: {
    attacker_id: number | null;
    attacker_faction_id: number | null;
    defender_id: number | null;
    defender_faction_id: number | null;
    result: string | null;
    m_retaliation?: number | null;
  },
  memberId: number,
  enemyFactionId: number | null,
): string {
  const positiveResult = POSITIVE_ATTACK_RESULTS.includes(
    attack.result as (typeof POSITIVE_ATTACK_RESULTS)[number],
  );

  if (attack.attacker_id === memberId) {
    const againstEnemy =
      enemyFactionId === null || attack.defender_faction_id === enemyFactionId;

    if (!againstEnemy) {
      return "outside";
    }

    if (attack.result === "Hospitalized" && Number(attack.m_retaliation ?? 1) > 1) {
      return "retaliation";
    }

    if (attack.result === "Assist") {
      return "enemy_assist";
    }

    return positiveResult ? "enemy_success" : "enemy_attempt";
  }

  if (
    attack.defender_id === memberId &&
    enemyFactionId !== null &&
    attack.attacker_faction_id === enemyFactionId &&
    attack.defender_faction_id === HOME_FACTION_ID
  ) {
    return positiveResult ? "defend_lost" : "defend_won";
  }

  return "other";
}

function parseWarTypeQuery(url: URL): string | null | Response {
  const value = url.searchParams.get("war_type");
  if (value === null || value.trim() === "") {
    return null;
  }

  const warType = value.trim().toLowerCase();
  if (!WAR_TYPES.includes(warType as (typeof WAR_TYPES)[number])) {
    return json({ ok: false, error: "Invalid war_type", code: "INVALID_WAR_TYPE" }, 400);
  }

  return warType;
}
