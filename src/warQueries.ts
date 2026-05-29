import {
  CHAIN_BONUS_HITS_SQL,
  HOME_FACTION_ID,
  DEFEND_WON_RESULTS_SQL,
  POSITIVE_ATTACK_RESULTS,
  POSITIVE_RESULTS_SQL,
  WAR_TYPES,
} from "./constants";
import {
  DEFENSE_ACTION_WINDOW_SQL,
  OUTGOING_ACTION_WINDOW_SQL,
  WAR_SELECT_COLUMNS,
  WAR_SELECT_COLUMNS_WITH_ALIAS,
} from "./sql";
import { warNameFromWarRoute } from "./routes";
import { Env, WarRow, WarSummaryRow } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

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
        COALESCE(ws.attacks_vs_enemy_total, 0) AS attacks_vs_enemy_total,
        COALESCE(ws.attacks_from_enemy_total, 0) AS attacks_from_enemy_total,
        COALESCE(ws.outside_hits, 0) AS outside_hits,
        COALESCE(ws.total_respect_gain, 0) AS total_respect_gain,
        COALESCE(ws.total_respect_gain_raw, 0) AS total_respect_gain_raw,
        COALESCE(ws.total_respect_lost, 0) AS total_respect_lost,
        COALESCE(ws.total_respect_lost_raw, 0) AS total_respect_lost_raw,
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
    const name = warNameFromWarRoute(url);

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
        CASE
          WHEN ? IS NOT NULL AND ? > 0
          THEN wms.respect_gained * 100.0 / ?
          ELSE NULL
        END AS member_respect_limit_percent
      FROM war_member_stats wms
      WHERE wms.war_id = ?
      ORDER BY respect_gained DESC, attacks_vs_enemy_successful DESC, attacks_vs_enemy_total DESC
      `,
    )
      .bind(war.member_respect_limit, war.member_respect_limit, war.member_respect_limit, war.id)
      .all();
    return json({
      ok: true,
      war,
      summary,
      members: memberStats.results ?? [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarChainBonusesForWar(url: URL, env: Env): Promise<Response> {
  try {
    const name = warNameFromWarRoute(url);

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const limit = parseLimit(url.searchParams.get("limit"), 25, 100);
    const war = (await env.DB.prepare(
      `
      SELECT id, name
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as { id: number; name: string } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const chainBonuses = await env.DB.prepare(
      `
      SELECT
        a.id,
        a.started,
        a.attacker_id,
        a.attacker_name,
        a.attacker_faction_id,
        a.attacker_faction_name,
        a.defender_id,
        a.defender_name,
        a.defender_faction_id,
        a.defender_faction_name,
        a.result,
        a.chain,
        a.respect_gain,
        a.respect_loss,
        NULL AS adjusted_respect_gain,
        NULL AS respect_removed
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
      ORDER BY a.chain DESC, a.started ASC
      LIMIT ?
      `,
    )
      .bind(war.id, limit)
      .all();

    return json({
      ok: true,
      war,
      chain_bonuses: chainBonuses.results ?? [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarAttacks(url: URL, env: Env): Promise<Response> {
  try {
    const name = warNameFromWarRoute(url);

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
    const name = warNameFromWarRoute(url);
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
        status: war.status,
        enemy_faction_id: war.enemy_faction_id,
        practical_finish_time: war.practical_finish_time,
        official_end_time: war.official_end_time,
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
    const name = warNameFromWarRoute(url);

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const bucketMinutes = parseBucketMinutes(url.searchParams.get("bucket_minutes"));
    const bucketSeconds = bucketMinutes * 60;
    const windowMode = parseActivityWindow(url.searchParams.get("window"));
    if (windowMode instanceof Response) {
      return windowMode;
    }
    const outgoingWindowSql =
      windowMode === "official" ? OFFICIAL_OUTGOING_ACTION_WINDOW_SQL : OUTGOING_ACTION_WINDOW_SQL;
    const activityWindowSql =
      windowMode === "official" ? OFFICIAL_ACTIVITY_WINDOW_SQL : PRACTICAL_ACTIVITY_WINDOW_SQL;

    const war = (await env.DB.prepare(
      `
      SELECT
        id,
        name,
        enemy_faction_id,
        practical_start_time,
        practical_finish_time,
        official_start_time,
        official_end_time
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as {
      id: number;
      name: string;
      enemy_faction_id: number | null;
      practical_start_time: number;
      practical_finish_time: number | null;
      official_start_time: number | null;
      official_end_time: number | null;
    } | null;

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
           AND ${outgoingWindowSql}
          THEN 1
          ELSE 0
        END) AS enemy_success,
        SUM(CASE
          WHEN a.attacker_faction_id = ${HOME_FACTION_ID}
           AND (? IS NULL OR a.defender_faction_id = ?)
           AND a.result = 'Assist'
           AND ${outgoingWindowSql}
          THEN 1
          ELSE 0
        END) AS enemy_assist,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND a.attacker_faction_id = ${HOME_FACTION_ID}
           AND ${outgoingWindowSql}
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
            AND a.result IN (${DEFEND_WON_RESULTS_SQL})
            AND ${DEFENSE_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS defend_won,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND a.attacker_faction_id = ?
           AND a.defender_faction_id = ${HOME_FACTION_ID}
           AND (
             a.result IS NULL
             OR (
               a.result NOT IN (${POSITIVE_RESULTS_SQL})
               AND a.result NOT IN (${DEFEND_WON_RESULTS_SQL})
             )
           )
           AND ${DEFENSE_ACTION_WINDOW_SQL}
          THEN 1
          ELSE 0
        END) AS defend_other
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
        AND ${activityWindowSql}
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
        war.enemy_faction_id,
        war.enemy_faction_id,
        war.id,
      )
      .all();

    const rawBuckets = (rows.results ?? []).map((row: any) => ({
      bucket_start: Number(row.bucket_start),
      enemy_success: Number(row.enemy_success ?? 0),
      enemy_assist: Number(row.enemy_assist ?? 0),
      outside: Number(row.outside ?? 0),
      defend_lost: Number(row.defend_lost ?? 0),
      defend_won: Number(row.defend_won ?? 0),
      defend_other: Number(row.defend_other ?? 0),
    }));
    const buckets = fillActivityWindowBuckets(
      rawBuckets,
      activityWindowBounds(war, windowMode),
      bucketSeconds,
    );

    return json({
      ok: true,
      war: {
        id: war.id,
        name: war.name,
        enemy_faction_id: war.enemy_faction_id,
        practical_start_time: war.practical_start_time,
        practical_finish_time: war.practical_finish_time,
        official_start_time: war.official_start_time,
        official_end_time: war.official_end_time,
      },
      bucket_minutes: bucketMinutes,
      window: windowMode,
      buckets,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarMemberActivityHeatmap(url: URL, env: Env): Promise<Response> {
  try {
    const name = warNameFromWarRoute(url);

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const bucketMinutes = 15;
    const bucketSeconds = bucketMinutes * 60;
    const war = (await env.DB.prepare(
      `
      SELECT
        id,
        name,
        enemy_faction_id,
        practical_start_time,
        practical_finish_time,
        official_start_time,
        official_end_time
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as {
      id: number;
      name: string;
      enemy_faction_id: number | null;
      practical_start_time: number;
      practical_finish_time: number | null;
      official_start_time: number | null;
      official_end_time: number | null;
    } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const startBucket = Math.floor(war.practical_start_time / bucketSeconds) * bucketSeconds;
    const finishAt = war.practical_finish_time ?? nowSeconds();
    const finishBucket = finishAt >= war.practical_start_time
      ? Math.floor(finishAt / bucketSeconds) * bucketSeconds
      : startBucket - bucketSeconds;
    const timeBuckets: number[] = [];

    for (let bucketStart = startBucket; bucketStart <= finishBucket; bucketStart += bucketSeconds) {
      timeBuckets.push(bucketStart);
    }

    const members = await env.DB.prepare(
      `
      SELECT
        member_id,
        member_name,
        attacks_vs_enemy_successful,
        outside_hits,
        defends_total,
        defends_won,
        defends_other,
        respect_gained,
        respect_lost
      FROM war_member_stats
      WHERE war_id = ?
      ORDER BY respect_gained DESC, attacks_vs_enemy_successful DESC, member_name ASC
      `,
    )
      .bind(war.id)
      .all();

    const buckets = timeBuckets.length === 0
      ? { results: [] }
      : await env.DB.prepare(
        `
        SELECT
          war_id,
          member_id,
          bucket_start,
          attacks_successful,
          outside_hits,
          defends_lost,
          respect_gained,
          respect_lost
        FROM war_member_activity_buckets
        WHERE war_id = ?
          AND bucket_start BETWEEN ? AND ?
        ORDER BY bucket_start ASC, member_id ASC
        `,
      )
        .bind(war.id, startBucket, finishBucket)
        .all();

    return json({
      ok: true,
      bucket_minutes: bucketMinutes,
      war: {
        id: war.id,
        name: war.name,
        enemy_faction_id: war.enemy_faction_id,
        practical_start_time: war.practical_start_time,
        practical_finish_time: war.practical_finish_time,
        official_start_time: war.official_start_time,
        official_end_time: war.official_end_time,
      },
      time_buckets: timeBuckets,
      members: members.results ?? [],
      buckets: buckets.results ?? [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

type ActivityBucket = {
  bucket_start: number;
  enemy_success: number;
  enemy_assist: number;
  outside: number;
  defend_lost: number;
  defend_won: number;
  defend_other: number;
};

type ActivityWindowWar = {
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
};

function activityWindowBounds(
  war: ActivityWindowWar,
  windowMode: "practical" | "official",
): { start: number; finish: number | null } {
  if (windowMode === "official") {
    return {
      start: war.official_start_time ?? war.practical_start_time,
      finish: war.official_end_time,
    };
  }

  return {
    start: war.practical_start_time,
    finish: war.practical_finish_time,
  };
}

function fillActivityWindowBuckets(
  rawBuckets: ActivityBucket[],
  bounds: { start: number; finish: number | null },
  bucketSeconds: number,
): ActivityBucket[] {
  if (bounds.finish === null || bounds.finish < bounds.start || bucketSeconds <= 0) {
    return rawBuckets;
  }

  const bucketsByStart = new Map(rawBuckets.map((bucket) => [bucket.bucket_start, bucket]));
  const startBucket = Math.floor(bounds.start / bucketSeconds) * bucketSeconds;
  const finishBucket = Math.floor(bounds.finish / bucketSeconds) * bucketSeconds;
  const buckets: ActivityBucket[] = [];

  for (let bucketStart = startBucket; bucketStart <= finishBucket; bucketStart += bucketSeconds) {
    buckets.push(
      bucketsByStart.get(bucketStart) ?? {
        bucket_start: bucketStart,
        enemy_success: 0,
        enemy_assist: 0,
        outside: 0,
        defend_lost: 0,
        defend_won: 0,
        defend_other: 0,
      },
    );
  }

  return buckets;
}

export async function getOverallStats(url: URL, env: Env): Promise<Response> {
  const warType = parseWarTypeQuery(url);
  if (warType instanceof Response) {
    return warType;
  }
  const currentMembersOnly = url.searchParams.get("current_members") === "1";

  const overall = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_wars,
      COALESCE(SUM(ws.attacks_vs_enemy_total), 0) AS attacks_vs_enemy_total,
      COALESCE(SUM(ws.attacks_from_enemy_total), 0) AS attacks_from_enemy_total,
      COALESCE(SUM(ws.outside_hits), 0) AS outside_hits,
      COALESCE(SUM(ws.total_respect_gain), 0) AS total_respect_gain,
      COALESCE(SUM(ws.total_respect_gain_raw), 0) AS total_respect_gain_raw,
      COALESCE(SUM(ws.total_respect_lost), 0) AS total_respect_lost,
      COALESCE(SUM(ws.total_respect_lost_raw), 0) AS total_respect_lost_raw,
      MAX(ws.last_attack_at) AS latest_attack_started
    FROM war_summary ws
    JOIN wars w ON w.id = ws.war_id
    WHERE (? IS NULL OR COALESCE(w.war_type, 'real') = ?)
    `,
  )
    .bind(warType, warType)
    .first()) as Record<string, number | null> | null;

  const members = await env.DB.prepare(
    `
    SELECT
      wms.member_id,
      MAX(wms.member_name) AS member_name,
      COALESCE(MAX(h.is_current), 0) AS is_current_member,
      COALESCE(MAX(h.report_exempt), 0) AS report_exempt,
      COUNT(DISTINCT wms.war_id) AS wars_participated,
      COALESCE(SUM(wms.attacks_vs_enemy_total), 0) AS attacks_vs_enemy_total,
      COALESCE(SUM(wms.attacks_vs_enemy_successful), 0) AS attacks_vs_enemy_successful,
      COALESCE(SUM(wms.respect_gained), 0) AS respect_gained,
      COALESCE(SUM(wms.respect_gained_raw), 0) AS respect_gained_raw,
      COALESCE(SUM(wms.chain_bonus_hits_vs_enemy), 0) AS chain_bonus_hits_vs_enemy,
      COALESCE(SUM(wms.chain_bonus_respect_removed), 0) AS chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(NULLIF(wms.chain_bonus_hit_values_vs_enemy, ''), ', '), '') AS chain_bonus_hit_values_vs_enemy,
      COALESCE(GROUP_CONCAT(NULLIF(wms.chain_bonus_hit_details_vs_enemy, ''), char(10)), '') AS chain_bonus_hit_details_vs_enemy,
      COALESCE(SUM(wms.assists_vs_enemy), 0) AS assists_vs_enemy,
      COALESCE(SUM(wms.hospitalizations_vs_enemy), 0) AS hospitalizations_vs_enemy,
      COALESCE(SUM(wms.mugs_vs_enemy), 0) AS mugs_vs_enemy,
      COALESCE(SUM(wms.retaliations_vs_enemy), 0) AS retaliations_vs_enemy,
      COALESCE(SUM(wms.outside_hits), 0) AS outside_hits,
      COALESCE(SUM(wms.friendly_hosps), 0) AS friendly_hosps,
      CASE
        WHEN COALESCE(SUM(wms.attacks_vs_enemy_total), 0) > 0
        THEN SUM(COALESCE(wms.average_fair_fight, 0) * wms.attacks_vs_enemy_total) * 1.0
          / SUM(wms.attacks_vs_enemy_total)
        ELSE NULL
      END AS average_fair_fight,
      AVG(CASE
        WHEN w.member_respect_limit IS NOT NULL AND w.member_respect_limit > 0
        THEN wms.respect_gained * 100.0 / w.member_respect_limit
        ELSE NULL
      END) AS member_respect_limit_percent,
      COALESCE(SUM(wms.defends_total), 0) AS defends_total,
      COALESCE(SUM(wms.defends_won), 0) AS defends_won,
      COALESCE(SUM(wms.defends_other), 0) AS defends_other,
      COALESCE(SUM(wms.defends_lost_non_hospitalized), 0) AS defends_lost_non_hospitalized,
      COALESCE(SUM(wms.respect_lost), 0) AS respect_lost,
      COALESCE(SUM(wms.respect_lost_non_hospitalized), 0) AS respect_lost_non_hospitalized,
      COALESCE(SUM(wms.respect_lost_raw), 0) AS respect_lost_raw,
      COALESCE(SUM(wms.enemy_chain_bonus_hits_received), 0) AS enemy_chain_bonus_hits_received,
      COALESCE(SUM(wms.enemy_chain_bonus_respect_removed), 0) AS enemy_chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(NULLIF(wms.enemy_chain_bonus_hit_values_received, ''), ', '), '') AS enemy_chain_bonus_hit_values_received,
      COALESCE(GROUP_CONCAT(NULLIF(wms.enemy_chain_bonus_hit_details_received, ''), char(10)), '') AS enemy_chain_bonus_hit_details_received,
      MIN(wms.first_action_at) AS first_seen_at,
      MAX(wms.last_action_at) AS last_seen_at
    FROM war_member_stats wms
    JOIN wars w ON w.id = wms.war_id
    LEFT JOIN home_faction_members h ON h.member_id = wms.member_id
    WHERE (? IS NULL OR COALESCE(w.war_type, 'real') = ?)
      AND (? = 0 OR COALESCE(h.is_current, 0) = 1)
      AND COALESCE(h.report_exempt, 0) = 0
    GROUP BY wms.member_id
    ORDER BY respect_gained DESC, attacks_vs_enemy_successful DESC, attacks_vs_enemy_total DESC
    `,
  )
    .bind(warType, warType, currentMembersOnly ? 1 : 0)
    .all();

  const memberRows = (members.results ?? []) as Array<Record<string, any>>;
  const responseOverall = currentMembersOnly && overall
    ? overallForFilteredMembers(overall, memberRows)
    : overall;

  return json({
    ok: true,
    war_type: warType,
    current_members_only: currentMembersOnly,
    overall: responseOverall,
    members: memberRows,
  });
}

function overallForFilteredMembers(
  overall: Record<string, number | null>,
  members: Array<Record<string, any>>,
): Record<string, number | null> {
  return {
    ...overall,
    attacks_vs_enemy_total: sumMemberRows(members, "attacks_vs_enemy_total"),
    outside_hits: sumMemberRows(members, "outside_hits"),
    total_respect_gain: sumMemberRows(members, "respect_gained"),
    total_respect_gain_raw: sumMemberRows(members, "respect_gained_raw"),
    total_respect_lost: sumMemberRows(members, "respect_lost"),
    total_respect_lost_raw: sumMemberRows(members, "respect_lost_raw"),
    latest_attack_started: members.reduce<number | null>((latest, member) => {
      const value = Number(member.last_seen_at);
      if (!Number.isFinite(value) || value <= 0) {
        return latest;
      }
      return latest === null ? value : Math.max(latest, value);
    }, null),
  };
}

function sumMemberRows(members: Array<Record<string, any>>, key: string): number {
  return members.reduce((total, member) => {
    const value = Number(member[key] ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function parseBucketMinutes(value: string | null): number {
  const parsed = Number(value ?? 15);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 15;
  }

  return Math.min(parsed, 120);
}

function parseActivityWindow(value: string | null): "practical" | "official" | Response {
  if (value === null || value.trim() === "" || value === "practical") {
    return "practical";
  }

  if (value === "official") {
    return "official";
  }

  return json({ ok: false, error: "Invalid activity window", code: "INVALID_ACTIVITY_WINDOW" }, 400);
}

const OFFICIAL_OUTGOING_ACTION_WINDOW_SQL = `
  (
    a.started IS NULL
    OR (
      a.started >= COALESCE(w.official_start_time, w.practical_start_time)
      AND (w.official_end_time IS NULL OR a.started <= w.official_end_time)
    )
  )
`;

const PRACTICAL_ACTIVITY_WINDOW_SQL = `
  a.started >= w.practical_start_time
  AND (w.practical_finish_time IS NULL OR a.started <= w.practical_finish_time)
`;

const OFFICIAL_ACTIVITY_WINDOW_SQL = `
  a.started >= COALESCE(w.official_start_time, w.practical_start_time)
  AND (w.official_end_time IS NULL OR a.started <= w.official_end_time)
`;

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
    if (positiveResult) {
      return "defend_lost";
    }

    return attack.result === "Lost" ? "defend_won" : "defend_other";
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
