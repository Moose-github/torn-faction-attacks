import {
  CHAIN_BONUS_HITS_SQL,
  HOME_FACTION_ID,
  KNOWN_UNSUCCESSFUL_RESULTS_SQL,
  POSITIVE_RESULTS_SQL,
  RANKED_WAR_REPORT_API_BASE_URL,
} from "./constants";
import { OUTGOING_ACTION_WINDOW_SQL } from "./sql";
import { Env, TornRankedWarReport, TornRankedWarReportResponse } from "./types";
import { json, nowSeconds } from "./utils";

export async function fetchRankedWarReport(url: URL, env: Env): Promise<Response> {
  try {
    const tornWarId = Number(url.pathname.split("/")[3]);

    if (!Number.isInteger(tornWarId) || tornWarId <= 0) {
      return json({ ok: false, error: "Invalid torn_war_id", code: "INVALID_TORN_WAR_ID" }, 400);
    }

    const war = (await env.DB.prepare(
      `
      SELECT id, name, faction_id, torn_war_id
      FROM wars
      WHERE torn_war_id = ?
      LIMIT 1
      `,
    )
      .bind(tornWarId)
      .first()) as { id: number; name: string; faction_id: number | null; torn_war_id: number } | null;

    if (!war) {
      return json(
        {
          ok: false,
          error: "No local war found with that Torn war ID",
          code: "WAR_NOT_FOUND",
        },
        404,
      );
    }

    const report = await fetchTornRankedWarReport(tornWarId, env);
    if (!report) {
      return json(
        {
          ok: false,
          error: "Torn did not return a ranked war report",
          code: "REPORT_NOT_FOUND",
        },
        404,
      );
    }

    const result = await applyRankedWarReport(
      env,
      war.id,
      war.name,
      war.faction_id,
      tornWarId,
      report,
    );

    return json({ ok: true, ...result });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getWarReportDiscrepancies(url: URL, env: Env): Promise<Response> {
  try {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

    if (!name) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
    }

    const war = (await env.DB.prepare(
      `
      SELECT
        id,
        name,
        start_time,
        finish_time,
        official_start_time,
        official_end_time,
        faction_id,
        war_type
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as {
      id: number;
      name: string;
      start_time: number;
      finish_time: number | null;
      official_start_time: number | null;
      official_end_time: number | null;
      faction_id: number | null;
      war_type: string | null;
    } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const officialStartTime = war.official_start_time ?? war.start_time;
    const officialEndTime = war.official_end_time;

    const groups = {
      after_practical_finish: await getDiscrepancyGroup(
        env,
        war.id,
        `
        a.attacker_faction_id = ${HOME_FACTION_ID}
        AND (
          a.defender_faction_id IS NULL
          OR a.defender_faction_id != ${HOME_FACTION_ID}
        )
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (? IS NOT NULL AND a.started > ?)
        AND (? IS NULL OR a.started <= ?)
        AND (? IS NULL OR a.defender_faction_id = ?)
        `,
        [
          war.finish_time,
          war.finish_time,
          officialEndTime,
          officialEndTime,
          war.faction_id,
          war.faction_id,
        ],
      ),
      uncounted_enemy_results: await getDiscrepancyGroup(
        env,
        war.id,
        `
        a.attacker_faction_id = ${HOME_FACTION_ID}
        AND (
          a.defender_faction_id IS NULL
          OR a.defender_faction_id != ${HOME_FACTION_ID}
        )
        AND (? IS NULL OR a.defender_faction_id = ?)
        AND (
          a.result IS NULL
          OR (
            a.result NOT IN (${POSITIVE_RESULTS_SQL})
            AND a.result NOT IN (${KNOWN_UNSUCCESSFUL_RESULTS_SQL})
          )
        )
        AND (? IS NULL OR a.started >= ?)
        AND (? IS NULL OR a.started <= ?)
        `,
        [war.faction_id, war.faction_id, war.start_time, war.start_time, war.finish_time, war.finish_time],
      ),
      chain_bonus_adjustments: await getChainBonusAdjustmentGroup(env, war.id),
      outside_official_window: await getDiscrepancyGroup(
        env,
        war.id,
        `
        a.started IS NOT NULL
        AND (
          a.defender_faction_id IS NULL
          OR a.defender_faction_id != ${HOME_FACTION_ID}
        )
        AND (
          a.started < ?
          OR (? IS NOT NULL AND a.started > ?)
        )
        `,
        [officialStartTime, officialEndTime, officialEndTime],
      ),
    };

    return json({
      ok: true,
      war: {
        id: war.id,
        name: war.name,
        start_time: war.start_time,
        finish_time: war.finish_time,
        official_start_time: officialStartTime,
        official_end_time: officialEndTime,
        faction_id: war.faction_id,
        war_type: war.war_type ?? "real",
      },
      groups,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function fetchTornRankedWarReport(tornWarId: number, env: Env) {
  const url = new URL(`${RANKED_WAR_REPORT_API_BASE_URL}/${tornWarId}/rankedwarreport`);
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn ranked war report API error: ${response.status}`);
  }

  const data = (await response.json()) as TornRankedWarReportResponse;
  return data.rankedwarreport ?? null;
}

export async function applyRankedWarReport(
  env: Env,
  warId: number,
  warName: string,
  factionId: number | null,
  tornWarId: number,
  report: TornRankedWarReport,
): Promise<{
  war_id: number;
  war_name: string;
  torn_war_id: number;
  winner_faction_id: number | null;
  home_report_score: number | null;
  home_report_attacks: number | null;
  enemy_report_score: number | null;
  enemy_report_attacks: number | null;
  home_report_members: number;
  report_added_members: number;
}> {
  const factions = report.factions ?? [];
  const homeFaction = factions.find((faction) => faction.id === HOME_FACTION_ID) ?? null;
  const enemyFaction =
    factions.find((faction) => factionId !== null && faction.id === factionId) ??
    factions.find((faction) => faction.id !== HOME_FACTION_ID) ??
    null;

  await env.DB.prepare(
    `
    UPDATE wars
    SET winner_faction_id = ?,
        torn_report_fetched_at = ?,
        official_start_time = COALESCE(official_start_time, ?),
        official_end_time = COALESCE(official_end_time, ?),
        home_report_score = ?,
        home_report_attacks = ?,
        enemy_report_score = ?,
        enemy_report_attacks = ?
    WHERE id = ?
    `,
  )
    .bind(
      report.winner ?? null,
      nowSeconds(),
      report.start ?? null,
      report.end && report.end > 0 ? report.end : null,
      homeFaction?.score ?? null,
      homeFaction?.attacks ?? null,
      enemyFaction?.score ?? null,
      enemyFaction?.attacks ?? null,
      warId,
    )
    .run();

  const existingMemberRows = await env.DB.prepare(
    `
    SELECT member_id
    FROM war_member_stats
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .all();

  const existingMemberIds = new Set(
    (existingMemberRows.results ?? []).map((row: any) => Number(row.member_id)),
  );
  const missingMembers = (homeFaction?.members ?? []).filter(
    (member) => !existingMemberIds.has(member.id),
  );

  if (missingMembers.length > 0) {
    await env.DB.batch(
      missingMembers.map((member) =>
        env.DB.prepare(
          `
          INSERT INTO war_member_stats (
            war_id,
            member_id,
            member_name,
            enemy_attacks_total,
            enemy_attacks_successful,
            enemy_respect_gained,
            enemy_assists,
            enemy_hospitalizations,
            enemy_mugs,
            outside_attacks,
            friendly_hospitals,
            defends_total,
            defends_won,
            respect_lost,
            report_added
          )
          VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
          `,
        ).bind(warId, member.id, member.name ?? null),
      ),
    );
  }

  return {
    war_id: warId,
    war_name: warName,
    torn_war_id: tornWarId,
    winner_faction_id: report.winner ?? null,
    home_report_score: homeFaction?.score ?? null,
    home_report_attacks: homeFaction?.attacks ?? null,
    enemy_report_score: enemyFaction?.score ?? null,
    enemy_report_attacks: enemyFaction?.attacks ?? null,
    home_report_members: homeFaction?.members?.length ?? 0,
    report_added_members: missingMembers.length,
  };
}

export async function getWarChainBonuses(
  env: Env,
  warId: number,
  limit: number,
): Promise<unknown[]> {
  const rows = await env.DB.prepare(
    `
    WITH chain_adjustments AS (
      ${chainBonusAdjustmentSelectSql()}
    )
    SELECT *
    FROM chain_adjustments
    ORDER BY chain DESC, started ASC
    LIMIT ?
    `,
  )
    .bind(warId, warId, warId, limit)
    .all();

  return rows.results ?? [];
}

async function getDiscrepancyGroup(
  env: Env,
  warId: number,
  conditionSql: string,
  conditionBinds: unknown[],
): Promise<{
  count: number;
  respect_gain: number;
  attacks: unknown[];
}> {
  const countRow = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(a.respect_gain), 0) AS respect_gain
    FROM attacks a
    WHERE a.war_id = ?
      AND ${conditionSql}
    `,
  )
    .bind(warId, ...conditionBinds)
    .first()) as { count: number | null; respect_gain: number | null } | null;

  const sampleRows = await env.DB.prepare(
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
      a.respect_gain,
      a.respect_loss
    FROM attacks a
    WHERE a.war_id = ?
      AND ${conditionSql}
    ORDER BY a.started ASC
    LIMIT 20
    `,
  )
    .bind(warId, ...conditionBinds)
    .all();

  return {
    count: Number(countRow?.count ?? 0),
    respect_gain: Number(countRow?.respect_gain ?? 0),
    attacks: sampleRows.results ?? [],
  };
}

async function getChainBonusAdjustmentGroup(
  env: Env,
  warId: number,
): Promise<{
  count: number;
  respect_gain: number;
  attacks: unknown[];
}> {
  const countRow = (await env.DB.prepare(
    `
    WITH chain_adjustments AS (
      ${chainBonusAdjustmentSelectSql()}
    )
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(respect_removed), 0) AS respect_gain
    FROM chain_adjustments
    `,
  )
    .bind(warId, warId, warId)
    .first()) as { count: number | null; respect_gain: number | null } | null;

  const sampleRows = await env.DB.prepare(
    `
    WITH chain_adjustments AS (
      ${chainBonusAdjustmentSelectSql()}
    )
    SELECT *
    FROM chain_adjustments
    ORDER BY chain DESC, started ASC
    LIMIT 20
    `,
  )
    .bind(warId, warId, warId)
    .all();

  return {
    count: Number(countRow?.count ?? 0),
    respect_gain: Number(countRow?.respect_gain ?? 0),
    attacks: sampleRows.results ?? [],
  };
}

function chainBonusAdjustmentSelectSql(): string {
  return `
    WITH member_averages AS (
      SELECT
        a.war_id,
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.faction_id IS NULL OR a.defender_faction_id = w.faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.war_id, a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.faction_id IS NULL OR a.defender_faction_id = w.faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
    )
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
      COALESCE(ma.avg_respect, wa.avg_respect, 0) AS adjusted_respect_gain,
      a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0) AS respect_removed
    FROM attacks a
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.war_id = a.war_id AND ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND ${OUTGOING_ACTION_WINDOW_SQL}
      AND (w.faction_id IS NULL OR a.defender_faction_id = w.faction_id)
      AND a.result IN (${POSITIVE_RESULTS_SQL})
      AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
  `;
}
