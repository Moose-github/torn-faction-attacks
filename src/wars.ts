import {
  HOME_FACTION_ID,
  POSITIVE_ATTACK_RESULTS,
  POSITIVE_RESULTS_SQL,
  SOURCE_NAME,
  WAR_TYPES,
} from "./constants";
import {
  backfillWarAssignments,
  ingestHistoricalWarWindow,
  previewHistoricalWarWindow,
  setActiveWarState,
} from "./ingestion";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw } from "./summaries";
import { Env, WarRow, WarSummaryRow } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

export async function createWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      start_time?: unknown;
      faction_id?: unknown;
      war_type?: unknown;
      torn_war_id?: unknown;
      auto_end_enabled?: unknown;
      faction_respect_limit?: unknown;
      member_respect_limit?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    const now = nowSeconds();
    let startTime = now;
    const factionId =
      body.faction_id === undefined || body.faction_id === null
        ? null
        : Number(body.faction_id);
    const warType = parseWarType(body.war_type, "real");
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const autoEndEnabled = parseOptionalBoolean(body.auto_end_enabled) ? 1 : 0;
    const factionRespectLimit = parseOptionalNonNegativeNumber(
      body.faction_respect_limit,
      "faction_respect_limit",
    );
    const memberRespectLimit = parseOptionalNonNegativeNumber(
      body.member_respect_limit,
      "member_respect_limit",
    );

    if (body.start_time !== undefined) {
      const parsed = Number(body.start_time);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return json({ ok: false, error: "Invalid start_time", code: "INVALID_START_TIME" }, 400);
      }
      startTime = parsed;
    }

    if (factionId !== null && (!Number.isInteger(factionId) || factionId < 0)) {
      return json({ ok: false, error: "Invalid faction_id", code: "INVALID_FACTION_ID" }, 400);
    }

    const validationError = validateTermedWarFields(
      warType,
      autoEndEnabled,
      factionRespectLimit,
      memberRespectLimit,
    );
    if (validationError) {
      return validationError;
    }

    const status = startTime > now ? "scheduled" : "active";

    const existingActiveWar = (await env.DB.prepare(
      `SELECT id, name FROM wars WHERE status = 'active' LIMIT 1`,
    ).first()) as { id: number; name: string } | null;

    if (status === "active" && existingActiveWar) {
      return json(
        {
          ok: false,
          error: "Another war is already active",
          code: "ACTIVE_WAR_EXISTS",
          active_war: existingActiveWar,
        },
        400,
      );
    }

    const existingScheduledWar = (await env.DB.prepare(
      `SELECT id, name, start_time FROM wars WHERE status = 'scheduled' LIMIT 1`,
    ).first()) as { id: number; name: string; start_time: number } | null;

    if (status === "scheduled" && existingScheduledWar) {
      return json(
        {
          ok: false,
          error: "Another war is already scheduled",
          code: "SCHEDULED_WAR_EXISTS",
          scheduled_war: existingScheduledWar,
        },
        400,
      );
    }

    const war = (await env.DB.prepare(
      `
      INSERT INTO wars (
        name,
        status,
        start_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        id,
        name,
        status,
        start_time,
        finish_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit,
        last_respect_check_at,
        last_observed_respect,
        finalized_at
      `,
    )
      .bind(
        name,
        status,
        startTime,
        factionId,
        warType,
        tornWarId,
        autoEndEnabled,
        factionRespectLimit,
        memberRespectLimit,
      )
      .first()) as WarRow | null;

    if (status === "active" && war) {
      await setActiveWarState(env, war.id, startTime);
      await backfillWarAssignments(env, war.id, startTime);
      await rebuildWarSummaryFromRaw(env, war.id);
      await rebuildWarMemberStatsFromRaw(env, war.id);
    }

    return json({ ok: true, war }, 201);
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function importHistoricalWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      start_time?: unknown;
      finish_time?: unknown;
      faction_id?: unknown;
      war_type?: unknown;
      torn_war_id?: unknown;
      auto_end_enabled?: unknown;
      faction_respect_limit?: unknown;
      member_respect_limit?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    const startTime = Number(body.start_time);
    const finishTime = Number(body.finish_time);
    const factionId =
      body.faction_id === undefined || body.faction_id === null
        ? null
        : Number(body.faction_id);
    const warType = parseWarType(body.war_type, "real");
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const autoEndEnabled = parseOptionalBoolean(body.auto_end_enabled) ? 1 : 0;
    const factionRespectLimit = parseOptionalNonNegativeNumber(
      body.faction_respect_limit,
      "faction_respect_limit",
    );
    const memberRespectLimit = parseOptionalNonNegativeNumber(
      body.member_respect_limit,
      "member_respect_limit",
    );
    const now = nowSeconds();

    if (!Number.isInteger(startTime) || startTime < 0) {
      return json({ ok: false, error: "Invalid start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (!Number.isInteger(finishTime) || finishTime < 0) {
      return json({ ok: false, error: "Invalid finish_time", code: "INVALID_FINISH_TIME" }, 400);
    }

    if (factionId !== null && (!Number.isInteger(factionId) || factionId < 0)) {
      return json({ ok: false, error: "Invalid faction_id", code: "INVALID_FACTION_ID" }, 400);
    }

    const validationError = validateTermedWarFields(
      warType,
      autoEndEnabled,
      factionRespectLimit,
      memberRespectLimit,
    );
    if (validationError) {
      return validationError;
    }

    if (finishTime < startTime) {
      return json(
        {
          ok: false,
          error: "finish_time must be greater than or equal to start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (finishTime > now) {
      return json(
        {
          ok: false,
          error: "finish_time cannot be in the future for historical import",
          code: "FINISH_TIME_IN_FUTURE",
        },
        400,
      );
    }

    const activeWar = (await env.DB.prepare(
      `SELECT id, name FROM wars WHERE status = 'active' LIMIT 1`,
    ).first()) as { id: number; name: string } | null;

    if (activeWar) {
      return json(
        {
          ok: false,
          error: "Cannot import a historical war while another war is active",
          code: "ACTIVE_WAR_EXISTS",
          active_war: activeWar,
        },
        400,
      );
    }

    const war = (await env.DB.prepare(
      `
      INSERT INTO wars (
        name,
        status,
        start_time,
        finish_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        id,
        name,
        status,
        start_time,
        finish_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit,
        last_respect_check_at,
        last_observed_respect,
        finalized_at
      `,
    )
      .bind(
        name,
        startTime,
        finishTime,
        factionId,
        warType,
        tornWarId,
        autoEndEnabled,
        factionRespectLimit,
        memberRespectLimit,
      )
      .first()) as WarRow | null;

    if (!war) {
      throw new Error("Failed to create war");
    }

    const importedAttackCount = await ingestHistoricalWarWindow(env, war.id, startTime, finishTime);
    await finalizeWar(env, war.id);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        start_time: startTime,
        finish_time: finishTime,
        imported_attack_count: importedAttackCount,
      },
      201,
    );
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function previewHistoricalWarImport(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      start_time?: unknown;
      finish_time?: unknown;
    };

    const startTime = Number(body.start_time);
    const finishTime = Number(body.finish_time);

    if (!Number.isInteger(startTime) || startTime < 0) {
      return json({ ok: false, error: "Invalid start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (!Number.isInteger(finishTime) || finishTime < 0) {
      return json({ ok: false, error: "Invalid finish_time", code: "INVALID_FINISH_TIME" }, 400);
    }

    if (finishTime < startTime) {
      return json(
        {
          ok: false,
          error: "finish_time must be greater than or equal to start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    const preview = await previewHistoricalWarWindow(env, startTime, finishTime);

    return json({
      ok: true,
      start_time: startTime,
      finish_time: finishTime,
      duration_seconds: finishTime - startTime,
      ...preview,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function deleteWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      name?: unknown;
    };
    const warId = parseOptionalInteger(body.id, "id");
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (warId === null && !name) {
      return json({ ok: false, error: "War id or name is required", code: "MISSING_WAR" }, 400);
    }

    const war = (await env.DB.prepare(
      `
      SELECT id, name, status
      FROM wars
      WHERE (? IS NOT NULL AND id = ?)
         OR (? != '' AND LOWER(name) = LOWER(?))
      LIMIT 1
      `,
    )
      .bind(warId, warId, name, name)
      .first()) as { id: number; name: string; status: string } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE attacks SET war_id = NULL WHERE war_id = ?`).bind(war.id),
      env.DB.prepare(`DELETE FROM war_member_stats WHERE war_id = ?`).bind(war.id),
      env.DB.prepare(`DELETE FROM war_summary WHERE war_id = ?`).bind(war.id),
      env.DB.prepare(`DELETE FROM wars WHERE id = ?`).bind(war.id),
    ]);

    if (war.status === "active") {
      await env.DB.prepare(
        `
        UPDATE sync_state
        SET active_war_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE name = ?
        `,
      )
        .bind(SOURCE_NAME)
        .run();
    }

    return json({ ok: true, deleted_war: war });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function endActiveWar(env: Env): Promise<Response> {
  const state = (await env.DB.prepare(
    `SELECT active_war_id FROM sync_state WHERE name = ?`,
  )
    .bind(SOURCE_NAME)
    .first()) as { active_war_id: number | null } | null;

  const activeWarId = state?.active_war_id ?? null;
  if (!activeWarId) {
    return json({ ok: false, error: "No active war" }, 400);
  }

  const endedAt = nowSeconds();

  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'ended', finish_time = ?
    WHERE id = ?
    `,
  )
    .bind(endedAt, activeWarId)
    .run();

  await env.DB.prepare(
    `
    UPDATE sync_state
    SET active_war_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
    `,
  )
    .bind(SOURCE_NAME)
    .run();

  await finalizeWar(env, activeWarId);

  return json({ ok: true, war_id: activeWarId, finish_time: endedAt });
}

export async function listWars(url: URL, env: Env): Promise<Response> {
  try {
    const warType = parseWarTypeQuery(url);
    if (warType instanceof Response) {
      return warType;
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        w.id,
        w.name,
        w.status,
        w.start_time,
        w.finish_time,
        w.faction_id,
        w.war_type,
        w.torn_war_id,
        w.auto_end_enabled,
        w.faction_respect_limit,
        w.member_respect_limit,
        w.last_respect_check_at,
        w.last_observed_respect,
        w.finalized_at,
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
      ORDER BY w.start_time DESC
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
        id,
        name,
        status,
        start_time,
        finish_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit,
        last_respect_check_at,
        last_observed_respect,
        finalized_at
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
      SELECT *
      FROM war_member_stats
      WHERE war_id = ?
      ORDER BY enemy_respect_gained DESC, enemy_attacks_successful DESC, enemy_attacks_total DESC
      `,
    )
      .bind(war.id)
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
        id,
        name,
        status,
        start_time,
        finish_time,
        faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit,
        last_respect_check_at,
        last_observed_respect,
        finalized_at
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

    const limit = parseLimit(url.searchParams.get("limit"), 100, 250);

    const war = (await env.DB.prepare(
      `
      SELECT id, name, faction_id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as { id: number; name: string; faction_id: number | null } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        id,
        started,
        ended,
        attacker_id,
        attacker_name,
        attacker_faction_id,
        attacker_faction_name,
        defender_id,
        defender_name,
        defender_faction_id,
        defender_faction_name,
        result,
        respect_gain,
        respect_loss
      FROM attacks
      WHERE war_id = ?
        AND (attacker_id = ? OR defender_id = ?)
      ORDER BY started DESC
      LIMIT ?
      `,
    )
      .bind(war.id, memberId, memberId, limit)
      .all();

    const attacks = (rows.results ?? []).map((attack: any) => ({
      ...attack,
      classification: classifyMemberAttack(attack, memberId, war.faction_id),
    }));

    return json({
      ok: true,
      war: {
        id: war.id,
        name: war.name,
        faction_id: war.faction_id,
      },
      member_id: memberId,
      paging: {
        limit,
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
      SELECT id, name, faction_id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(name)
      .first()) as { id: number; name: string; faction_id: number | null } | null;

    if (!war) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const rows = await env.DB.prepare(
      `
      SELECT
        CAST((started / ?) AS INTEGER) * ? AS bucket_start,
        SUM(CASE
          WHEN attacker_faction_id = ${HOME_FACTION_ID}
           AND (? IS NULL OR defender_faction_id = ?)
           AND result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS enemy_success,
        SUM(CASE
          WHEN attacker_faction_id = ${HOME_FACTION_ID}
           AND (? IS NULL OR defender_faction_id = ?)
           AND result = 'Assist'
          THEN 1
          ELSE 0
        END) AS enemy_assist,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND attacker_faction_id = ${HOME_FACTION_ID}
           AND (defender_faction_id IS NULL OR defender_faction_id != ?)
           AND NOT (
             defender_faction_id = ${HOME_FACTION_ID}
             AND result = 'Hospitalized'
           )
          THEN 1
          ELSE 0
        END) AS outside,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND attacker_faction_id = ?
           AND defender_faction_id = ${HOME_FACTION_ID}
           AND result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS defend_lost,
        SUM(CASE
          WHEN ? IS NOT NULL
           AND attacker_faction_id = ?
           AND defender_faction_id = ${HOME_FACTION_ID}
           AND (result NOT IN (${POSITIVE_RESULTS_SQL}) OR result IS NULL)
          THEN 1
          ELSE 0
        END) AS defend_won
      FROM attacks
      WHERE war_id = ?
        AND started IS NOT NULL
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
      `,
    )
      .bind(
        bucketSeconds,
        bucketSeconds,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
        war.faction_id,
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
        faction_id: war.faction_id,
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

  const topMembers = await env.DB.prepare(
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
    LIMIT 25
    `,
  )
    .bind(warType, warType)
    .all();

  return json({
    ok: true,
    war_type: warType,
    overall,
    top_members: topMembers.results ?? [],
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

function handleMutationError(err: any): Response {
  if (err instanceof ValidationError) {
    return json({ ok: false, error: err.message, code: err.code }, 400);
  }

  const message = err?.message || String(err);

  if (message.includes("Unexpected token")) {
    return json({ ok: false, error: "Invalid JSON body", code: "INVALID_JSON" }, 400);
  }

  if (message.includes("UNIQUE constraint failed: wars.name")) {
    return json({ ok: false, error: "War name already exists", code: "WAR_NAME_EXISTS" }, 400);
  }

  return json({ ok: false, error: message, code: "INTERNAL_ERROR" }, 500);
}

class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function parseWarType(value: unknown, fallback: string): string {
  const warType =
    value === undefined || value === null ? fallback : String(value).trim().toLowerCase();

  if (!WAR_TYPES.includes(warType as (typeof WAR_TYPES)[number])) {
    throw new ValidationError("Invalid war_type", "INVALID_WAR_TYPE");
  }

  return warType;
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

function parseOptionalBoolean(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  throw new ValidationError("Invalid auto_end_enabled", "INVALID_AUTO_END_ENABLED");
}

function parseOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`Invalid ${field}`, `INVALID_${field.toUpperCase()}`);
  }

  return parsed;
}

function parseOptionalNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`Invalid ${field}`, `INVALID_${field.toUpperCase()}`);
  }

  return parsed;
}

function validateTermedWarFields(
  warType: string,
  autoEndEnabled: number,
  factionRespectLimit: number | null,
  memberRespectLimit: number | null,
): Response | null {
  if (warType !== "termed") {
    if (autoEndEnabled === 1 || factionRespectLimit !== null || memberRespectLimit !== null) {
      return json(
        {
          ok: false,
          error: "Termed war fields can only be set when war_type is termed",
          code: "TERM_FIELDS_REQUIRE_TERMED_WAR",
        },
        400,
      );
    }

    return null;
  }

  if (autoEndEnabled === 1 && factionRespectLimit === null) {
    return json(
      {
        ok: false,
        error: "faction_respect_limit is required when auto_end_enabled is true",
        code: "MISSING_FACTION_RESPECT_LIMIT",
      },
      400,
    );
  }

  return null;
}
