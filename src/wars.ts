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
  pullAttackWindow,
  setActiveWarState,
} from "./ingestion";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw } from "./summaries";
import {
  applyRankedWarReport,
  fetchTornRankedWarReport,
  getWarChainBonuses,
} from "./reports";
import {
  DEFENSE_ACTION_WINDOW_SQL,
  OUTGOING_ACTION_WINDOW_SQL,
  WAR_RETURNING_COLUMNS,
  WAR_SELECT_COLUMNS,
  WAR_SELECT_COLUMNS_WITH_ALIAS,
} from "./sql";
import { Env, WarRow, WarSummaryRow } from "./types";
import { corsHeaders, json, nowSeconds, parseLimit } from "./utils";

export async function createWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      practical_start_time?: unknown;
      start_time?: unknown;
      enemy_faction_id?: unknown;
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
    const enemyFactionValue = body.enemy_faction_id ?? body.faction_id;
    const enemyFactionId =
      enemyFactionValue === undefined || enemyFactionValue === null
        ? null
        : Number(enemyFactionValue);
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

    const practicalStartValue = body.practical_start_time ?? body.start_time;
    if (practicalStartValue !== undefined) {
      const parsed = Number(practicalStartValue);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return json({ ok: false, error: "Invalid practical_start_time", code: "INVALID_START_TIME" }, 400);
      }
      startTime = parsed;
    }

    if (enemyFactionId !== null && (!Number.isInteger(enemyFactionId) || enemyFactionId < 0)) {
      return json({ ok: false, error: "Invalid enemy_faction_id", code: "INVALID_FACTION_ID" }, 400);
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
      `SELECT id, name, practical_start_time FROM wars WHERE status = 'scheduled' LIMIT 1`,
    ).first()) as { id: number; name: string; practical_start_time: number } | null;

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
        practical_start_time,
        enemy_faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(
        name,
        status,
        startTime,
        enemyFactionId,
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
      practical_start_time?: unknown;
      start_time?: unknown;
      practical_finish_time?: unknown;
      finish_time?: unknown;
      official_start_time?: unknown;
      official_finish_time?: unknown;
      enemy_faction_id?: unknown;
      faction_id?: unknown;
      war_type?: unknown;
      torn_war_id?: unknown;
      auto_end_enabled?: unknown;
      faction_respect_limit?: unknown;
      member_respect_limit?: unknown;
    };

    const warType = parseWarType(body.war_type, "real");
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const report = tornWarId !== null ? await fetchTornRankedWarReport(tornWarId, env) : null;
    const reportFactions = report?.factions ?? [];
    const reportEnemyFaction =
      reportFactions.find((faction) => faction.id !== HOME_FACTION_ID) ?? null;
    const enemyFactionValue = body.enemy_faction_id ?? body.faction_id;
    const bodyEnemyFactionId =
      enemyFactionValue === undefined || enemyFactionValue === null || enemyFactionValue === ""
        ? null
        : Number(enemyFactionValue);
    const enemyFactionId = reportEnemyFaction?.id ?? bodyEnemyFactionId;
    const generatedName =
      reportEnemyFaction?.name ??
      (typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : `historical-${tornWarId ?? Number(body.practical_start_time ?? body.start_time)}`);
    const name = await uniqueWarName(
      env,
      sanitizeWarName(generatedName),
    );
    const reportStartTime = report?.start ?? null;
    const reportFinishTime = report?.end && report.end > 0 ? report.end : null;
    const startTime =
      warType === "real" && reportStartTime !== null
        ? reportStartTime
        : Number(body.practical_start_time ?? body.start_time);
    const finishTime =
      warType === "real" && reportFinishTime !== null
        ? reportFinishTime
        : Number(body.practical_finish_time ?? body.finish_time);
    const autoEndEnabled = parseOptionalBoolean(body.auto_end_enabled) ? 1 : 0;
    const factionRespectLimit = parseOptionalNonNegativeNumber(
      body.faction_respect_limit,
      "faction_respect_limit",
    );
    const memberRespectLimit = parseOptionalNonNegativeNumber(
      body.member_respect_limit,
      "member_respect_limit",
    );
    const officialStartTime = optionalTimestampOrDefault(
      body.official_start_time,
      reportStartTime ?? startTime,
    );
    const officialFinishTime = optionalTimestampOrDefault(
      body.official_finish_time,
      reportFinishTime ?? finishTime,
    );
    const now = nowSeconds();

    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    if (warType === "real" && tornWarId === null) {
      return json(
        {
          ok: false,
          error: "torn_war_id is required for real historical war import",
          code: "MISSING_TORN_WAR_ID",
        },
        400,
      );
    }

    if (tornWarId !== null && !report) {
      return json(
        {
          ok: false,
          error: "Torn did not return a ranked war report",
          code: "REPORT_NOT_FOUND",
        },
        404,
      );
    }

    if (warType === "real" && (reportStartTime === null || reportFinishTime === null)) {
      return json(
        {
          ok: false,
          error: "Torn report start and end are required for real historical war import",
          code: "MISSING_REPORT_TIME_RANGE",
        },
        400,
      );
    }

    if (!Number.isInteger(startTime) || startTime < 0) {
      return json({ ok: false, error: "Invalid practical_start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (!Number.isInteger(finishTime) || finishTime < 0) {
      return json({ ok: false, error: "Invalid practical_finish_time", code: "INVALID_FINISH_TIME" }, 400);
    }

    if (!Number.isInteger(officialStartTime) || officialStartTime < 0) {
      return json(
        { ok: false, error: "Invalid official_start_time", code: "INVALID_OFFICIAL_START_TIME" },
        400,
      );
    }

    if (!Number.isInteger(officialFinishTime) || officialFinishTime < 0) {
      return json(
        { ok: false, error: "Invalid official_finish_time", code: "INVALID_OFFICIAL_FINISH_TIME" },
        400,
      );
    }

    if (enemyFactionId !== null && (!Number.isInteger(enemyFactionId) || enemyFactionId < 0)) {
      return json({ ok: false, error: "Invalid enemy_faction_id", code: "INVALID_FACTION_ID" }, 400);
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
          error: "practical_finish_time must be greater than or equal to practical_start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (officialFinishTime < officialStartTime) {
      return json(
        {
          ok: false,
          error: "official_finish_time must be greater than or equal to official_start_time",
          code: "INVALID_OFFICIAL_TIME_RANGE",
        },
        400,
      );
    }

    if (startTime < officialStartTime || finishTime > officialFinishTime) {
      return json(
        {
          ok: false,
          error: "Practical start/finish must sit inside the official start/finish window",
          code: "PRACTICAL_WINDOW_OUTSIDE_OFFICIAL_WINDOW",
        },
        400,
      );
    }

    if (officialFinishTime > now) {
      return json(
        {
          ok: false,
          error: "official_finish_time cannot be in the future for historical import",
          code: "OFFICIAL_FINISH_TIME_IN_FUTURE",
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
        practical_start_time,
        practical_finish_time,
        official_start_time,
        official_end_time,
        enemy_faction_id,
        war_type,
        torn_war_id,
        auto_end_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(
        name,
        startTime,
        finishTime,
        officialStartTime,
        officialFinishTime,
        enemyFactionId,
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

    const importedAttackCount = await ingestHistoricalWarWindow(
      env,
      war.id,
      officialStartTime,
      officialFinishTime,
    );
    const reportResult =
      report && tornWarId !== null
        ? await applyRankedWarReport(env, war.id, war.name, enemyFactionId, tornWarId, report)
        : null;
    await finalizeWar(env, war.id);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        practical_start_time: startTime,
        practical_finish_time: finishTime,
        official_start_time: officialStartTime,
        official_finish_time: officialFinishTime,
        imported_attack_count: importedAttackCount,
        torn_report: reportResult,
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
      practical_start_time?: unknown;
      start_time?: unknown;
      practical_finish_time?: unknown;
      finish_time?: unknown;
      official_start_time?: unknown;
      official_finish_time?: unknown;
      war_type?: unknown;
      torn_war_id?: unknown;
    };

    const warType = parseWarType(body.war_type, "real");
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const report = tornWarId !== null ? await fetchTornRankedWarReport(tornWarId, env) : null;
    const reportStartTime = report?.start ?? null;
    const reportFinishTime = report?.end && report.end > 0 ? report.end : null;
    const startTime =
      warType === "real" && reportStartTime !== null
        ? reportStartTime
        : Number(body.practical_start_time ?? body.start_time);
    const finishTime =
      warType === "real" && reportFinishTime !== null
        ? reportFinishTime
        : Number(body.practical_finish_time ?? body.finish_time);
    const officialStartTime = optionalTimestampOrDefault(
      body.official_start_time,
      reportStartTime ?? startTime,
    );
    const officialFinishTime = optionalTimestampOrDefault(
      body.official_finish_time,
      reportFinishTime ?? finishTime,
    );

    if (warType === "real" && tornWarId === null) {
      return json(
        {
          ok: false,
          error: "torn_war_id is required for real historical war preview",
          code: "MISSING_TORN_WAR_ID",
        },
        400,
      );
    }

    if (tornWarId !== null && !report) {
      return json(
        {
          ok: false,
          error: "Torn did not return a ranked war report",
          code: "REPORT_NOT_FOUND",
        },
        404,
      );
    }

    if (warType === "real" && (reportStartTime === null || reportFinishTime === null)) {
      return json(
        {
          ok: false,
          error: "Torn report start and end are required for real historical war preview",
          code: "MISSING_REPORT_TIME_RANGE",
        },
        400,
      );
    }

    if (!Number.isInteger(startTime) || startTime < 0) {
      return json({ ok: false, error: "Invalid practical_start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (!Number.isInteger(finishTime) || finishTime < 0) {
      return json({ ok: false, error: "Invalid practical_finish_time", code: "INVALID_FINISH_TIME" }, 400);
    }

    if (!Number.isInteger(officialStartTime) || officialStartTime < 0) {
      return json(
        { ok: false, error: "Invalid official_start_time", code: "INVALID_OFFICIAL_START_TIME" },
        400,
      );
    }

    if (!Number.isInteger(officialFinishTime) || officialFinishTime < 0) {
      return json(
        { ok: false, error: "Invalid official_finish_time", code: "INVALID_OFFICIAL_FINISH_TIME" },
        400,
      );
    }

    if (finishTime < startTime) {
      return json(
        {
          ok: false,
          error: "practical_finish_time must be greater than or equal to practical_start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (officialFinishTime < officialStartTime) {
      return json(
        {
          ok: false,
          error: "official_finish_time must be greater than or equal to official_start_time",
          code: "INVALID_OFFICIAL_TIME_RANGE",
        },
        400,
      );
    }

    if (startTime < officialStartTime || finishTime > officialFinishTime) {
      return json(
        {
          ok: false,
          error: "Practical start/finish must sit inside the official start/finish window",
          code: "PRACTICAL_WINDOW_OUTSIDE_OFFICIAL_WINDOW",
        },
        400,
      );
    }

    const preview = await previewHistoricalWarWindow(env, officialStartTime, officialFinishTime);

    return json({
      ok: true,
      practical_start_time: startTime,
      practical_finish_time: finishTime,
      official_start_time: officialStartTime,
      official_finish_time: officialFinishTime,
      duration_seconds: finishTime - startTime,
      official_duration_seconds: officialFinishTime - officialStartTime,
      ...preview,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function updateWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      name?: unknown;
      status?: unknown;
      practical_start_time?: unknown;
      practical_finish_time?: unknown;
      official_start_time?: unknown;
      official_finish_time?: unknown;
      official_end_time?: unknown;
      enemy_faction_id?: unknown;
      war_type?: unknown;
      torn_war_id?: unknown;
      auto_end_enabled?: unknown;
      faction_respect_limit?: unknown;
      member_respect_limit?: unknown;
    };

    const warId = Number(body.id);
    if (!Number.isInteger(warId) || warId <= 0) {
      return json({ ok: false, error: "Invalid war id", code: "INVALID_WAR_ID" }, 400);
    }

    const existing = (await env.DB.prepare(
      `
      SELECT id, name
      FROM wars
      WHERE id = ?
      LIMIT 1
      `,
    )
      .bind(warId)
      .first()) as { id: number; name: string } | null;

    if (!existing) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    const duplicateName = (await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
        AND id != ?
      LIMIT 1
      `,
    )
      .bind(name, warId)
      .first()) as { id: number } | null;

    if (duplicateName) {
      return json({ ok: false, error: "War name already exists", code: "WAR_NAME_EXISTS" }, 400);
    }

    const status = parseWarStatus(body.status);
    const practicalStartTime = Number(body.practical_start_time);
    const practicalFinishTime = parseOptionalInteger(
      body.practical_finish_time,
      "practical_finish_time",
    );
    const officialStartTime = parseOptionalInteger(body.official_start_time, "official_start_time");
    const officialFinishTime = parseOptionalInteger(
      body.official_finish_time ?? body.official_end_time,
      "official_finish_time",
    );
    const enemyFactionId = parseOptionalInteger(body.enemy_faction_id, "enemy_faction_id");
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

    if (status === "active" || status === "scheduled") {
      const conflictingWar = (await env.DB.prepare(
        `
        SELECT id, name, status
        FROM wars
        WHERE status = ?
          AND id != ?
        LIMIT 1
        `,
      )
        .bind(status, warId)
        .first()) as { id: number; name: string; status: string } | null;

      if (conflictingWar) {
        return json(
          {
            ok: false,
            error: `Another war is already ${status}`,
            code: status === "active" ? "ACTIVE_WAR_EXISTS" : "SCHEDULED_WAR_EXISTS",
            war: conflictingWar,
          },
          400,
        );
      }
    }

    if (!Number.isInteger(practicalStartTime) || practicalStartTime < 0) {
      return json({ ok: false, error: "Invalid practical_start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (practicalFinishTime !== null && practicalFinishTime < practicalStartTime) {
      return json(
        {
          ok: false,
          error: "practical_finish_time must be greater than or equal to practical_start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (
      officialStartTime !== null &&
      officialFinishTime !== null &&
      officialFinishTime < officialStartTime
    ) {
      return json(
        {
          ok: false,
          error: "official_finish_time must be greater than or equal to official_start_time",
          code: "INVALID_OFFICIAL_TIME_RANGE",
        },
        400,
      );
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

    const war = (await env.DB.prepare(
      `
      UPDATE wars
      SET name = ?,
          status = ?,
          practical_start_time = ?,
          practical_finish_time = ?,
          official_start_time = ?,
          official_end_time = ?,
          enemy_faction_id = ?,
          war_type = ?,
          torn_war_id = ?,
          auto_end_enabled = ?,
          faction_respect_limit = ?,
          member_respect_limit = ?
      WHERE id = ?
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(
        name,
        status,
        practicalStartTime,
        practicalFinishTime,
        officialStartTime,
        officialFinishTime,
        enemyFactionId,
        warType,
        tornWarId,
        autoEndEnabled,
        factionRespectLimit,
        memberRespectLimit,
        warId,
      )
      .first()) as WarRow | null;

    if (status === "active") {
      await setActiveWarState(env, warId, practicalStartTime);
    } else {
      await env.DB.prepare(
        `
        UPDATE sync_state
        SET active_war_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE name = ?
          AND active_war_id = ?
        `,
      )
        .bind(SOURCE_NAME, warId)
        .run();
    }

    await rebuildWarSummaryFromRaw(env, warId);
    await rebuildWarMemberStatsFromRaw(env, warId);

    return json({ ok: true, war });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function getAttackWindow(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      practical_start_time?: unknown;
      start_time?: unknown;
      practical_finish_time?: unknown;
      finish_time?: unknown;
      limit?: unknown;
    };

    const startTime = Number(body.practical_start_time ?? body.start_time);
    const finishTime = Number(body.practical_finish_time ?? body.finish_time);
    const limit =
      body.limit === undefined || body.limit === null || body.limit === ""
        ? 100
        : Number(body.limit);

    if (!Number.isInteger(startTime) || startTime < 0) {
      return json({ ok: false, error: "Invalid practical_start_time", code: "INVALID_START_TIME" }, 400);
    }

    if (!Number.isInteger(finishTime) || finishTime < 0) {
      return json({ ok: false, error: "Invalid practical_finish_time", code: "INVALID_FINISH_TIME" }, 400);
    }

    if (finishTime < startTime) {
      return json(
        {
          ok: false,
          error: "practical_finish_time must be greater than or equal to practical_start_time",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      return json({ ok: false, error: "Invalid limit", code: "INVALID_LIMIT" }, 400);
    }

    const window = await pullAttackWindow(env, startTime, finishTime, limit);

    return json({
      ok: true,
      practical_start_time: startTime,
      practical_finish_time: finishTime,
      duration_seconds: finishTime - startTime,
      ...window,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function deleteWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      torn_war_id?: unknown;
      name?: unknown;
    };
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (tornWarId === null && !name) {
      return json(
        {
          ok: false,
          error: "Torn war id or name is required",
          code: "MISSING_WAR",
        },
        400,
      );
    }

    const war = (await env.DB.prepare(
      `
      SELECT id, name, status
      FROM wars
      WHERE (? IS NOT NULL AND torn_war_id = ?)
         OR (? != '' AND LOWER(name) = LOWER(?))
      LIMIT 1
      `,
    )
      .bind(tornWarId, tornWarId, name, name)
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

type RelinkWarRow = Pick<
  WarRow,
  | "id"
  | "name"
  | "practical_start_time"
  | "practical_finish_time"
  | "official_start_time"
  | "official_end_time"
  | "status"
  | "enemy_faction_id"
  | "torn_war_id"
>;

type RelinkWarResult = {
  war_id: number;
  name: string;
  torn_war_id: number | null;
  fetched_missing_attacks: boolean;
  fetched_attack_count: number;
  existing_linked_attacks: number;
  matching_attacks: number;
  unassigned_matching_attacks: number;
  newly_linked_attacks: number;
};

export async function relinkWarAttacks(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      torn_war_id?: unknown;
      name?: unknown;
      dry_run?: unknown;
      fetch_missing?: unknown;
    };
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const dryRun = body.dry_run !== false;
    const fetchMissing = parseOptionalBoolean(body.fetch_missing);
    const wars = await readRelinkWars(env, tornWarId, name);

    if (wars.length === 0) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const results: RelinkWarResult[] = [];

    for (const war of wars) {
      const result = await relinkAttacksForWar(env, war, dryRun, fetchMissing);
      results.push(result);

      if (!dryRun) {
        await rebuildWarMemberStatsFromRaw(env, war.id);
        await rebuildWarSummaryFromRaw(env, war.id);
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      fetch_missing: fetchMissing,
      scope: tornWarId !== null || name ? "single_war" : "all_wars",
      wars_processed: results.length,
      total_fetched_attack_count: sumRelinkResults(results, "fetched_attack_count"),
      total_existing_linked_attacks: sumRelinkResults(results, "existing_linked_attacks"),
      total_matching_attacks: sumRelinkResults(results, "matching_attacks"),
      total_unassigned_matching_attacks: sumRelinkResults(results, "unassigned_matching_attacks"),
      total_newly_linked_attacks: sumRelinkResults(results, "newly_linked_attacks"),
      wars: results,
    });
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
    SET status = 'ended', practical_finish_time = ?
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

  return json({ ok: true, war_id: activeWarId, practical_finish_time: endedAt });
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
      SELECT *
      FROM war_member_stats
      WHERE war_id = ?
      ORDER BY enemy_respect_gained DESC, enemy_attacks_successful DESC, enemy_attacks_total DESC
      `,
    )
      .bind(war.id)
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

export async function exportWarAttacksCsv(url: URL, env: Env): Promise<Response> {
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

    const scope = parseExportOption(url.searchParams.get("scope"), [
      "all",
      "outgoing",
      "war_relevant",
    ] as const, "war_relevant");
    const windowMode = parseExportOption(url.searchParams.get("window"), [
      "official",
      "practical",
      "custom",
    ] as const, "official");
    const linkedStatus = parseExportOption(url.searchParams.get("linked_status"), [
      "linked",
      "matching",
      "unlinked",
    ] as const, "linked");
    const columns = parseExportOption(url.searchParams.get("columns"), [
      "standard",
      "debug",
    ] as const, "standard");
    const windowRange = exportWindowForWar(war, windowMode, url);

    if (windowRange instanceof Response) {
      return windowRange;
    }

    const conditions = ["a.started >= ?", "a.started <= ?"];
    const binds: unknown[] = [windowRange.start, windowRange.finish];

    if (linkedStatus === "linked") {
      conditions.push("a.war_id = ?");
      binds.push(war.id);
    } else if (linkedStatus === "unlinked") {
      conditions.push("a.war_id IS NULL");
    }

    if (scope === "outgoing") {
      conditions.push(`a.attacker_faction_id = ${HOME_FACTION_ID}`);
    } else if (scope === "war_relevant") {
      conditions.push(`
        (
          a.attacker_faction_id = ${HOME_FACTION_ID}
          OR (
            ? IS NOT NULL
            AND a.attacker_faction_id = ?
            AND a.defender_faction_id = ${HOME_FACTION_ID}
          )
        )
      `);
      binds.push(war.enemy_faction_id, war.enemy_faction_id);
    }

    const rows = await env.DB.prepare(
      `
      SELECT *
      FROM attacks a
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY a.started ASC, a.id ASC
      `,
    )
      .bind(...binds)
      .all();

    const csv = attacksToCsv((rows.results ?? []) as Record<string, unknown>[], columns);
    const filename = `${sanitizeFilename(war.name)}-${windowMode}-${scope}-${linkedStatus}.csv`;

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
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

async function readRelinkWars(
  env: Env,
  tornWarId: number | null,
  name: string,
): Promise<RelinkWarRow[]> {
  const filterSql =
    tornWarId !== null
      ? "WHERE torn_war_id = ?"
      : name
        ? "WHERE LOWER(name) = LOWER(?)"
        : "";
  const bindings = tornWarId !== null ? [tornWarId] : name ? [name] : [];
  const rows = await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      official_end_time,
      status,
      enemy_faction_id,
      torn_war_id
    FROM wars
    ${filterSql}
    ORDER BY practical_start_time ASC, id ASC
    `,
  )
    .bind(...bindings)
    .all();

  return (rows.results ?? []) as RelinkWarRow[];
}

async function relinkAttacksForWar(
  env: Env,
  war: RelinkWarRow,
  dryRun: boolean,
  fetchMissing: boolean,
): Promise<RelinkWarResult> {
  let fetchedMissingAttacks = false;
  let fetchedAttackCount = 0;

  if (fetchMissing && !dryRun) {
    const fetchWindow = relinkFetchWindow(war);
    if (fetchWindow !== null) {
      fetchedAttackCount = await ingestHistoricalWarWindow(
        env,
        war.id,
        fetchWindow.start,
        fetchWindow.finish,
      );
      fetchedMissingAttacks = true;
    }
  }

  const [existingLinked, matching, unassignedMatching] = await Promise.all([
    countLinkedAttacks(env, war.id),
    countMatchingRelinkAttacks(env, war.id, false),
    countMatchingRelinkAttacks(env, war.id, true),
  ]);
  let newlyLinkedAttacks = 0;

  if (!dryRun && unassignedMatching > 0) {
    const updateResult = await env.DB.prepare(
      `
      UPDATE attacks
      SET war_id = ?
      WHERE id IN (
        SELECT a.id
        FROM attacks a
        JOIN wars w ON w.id = ?
        WHERE a.war_id IS NULL
          AND ${RELINK_ATTACK_MATCH_SQL}
      )
      `,
    )
      .bind(war.id, war.id)
      .run();
    newlyLinkedAttacks = Number(updateResult.meta?.changes ?? 0);
  }

  return {
    war_id: war.id,
    name: war.name,
    torn_war_id: war.torn_war_id,
    fetched_missing_attacks: fetchedMissingAttacks,
    fetched_attack_count: fetchedAttackCount,
    existing_linked_attacks: existingLinked,
    matching_attacks: matching,
    unassigned_matching_attacks: unassignedMatching,
    newly_linked_attacks: newlyLinkedAttacks,
  };
}

function relinkFetchWindow(war: RelinkWarRow): { start: number; finish: number } | null {
  const start = war.official_start_time ?? war.practical_start_time;
  const finish = war.official_end_time ?? war.practical_finish_time;

  if (finish === null || finish < start) {
    return null;
  }

  return { start, finish };
}

async function countLinkedAttacks(env: Env, warId: number): Promise<number> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM attacks
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .first()) as { count: number } | null;

  return Number(row?.count ?? 0);
}

async function countMatchingRelinkAttacks(
  env: Env,
  warId: number,
  unassignedOnly: boolean,
): Promise<number> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM attacks a
    JOIN wars w ON w.id = ?
    WHERE ${unassignedOnly ? "a.war_id IS NULL AND" : ""}
      ${RELINK_ATTACK_MATCH_SQL}
    `,
  )
    .bind(warId)
    .first()) as { count: number } | null;

  return Number(row?.count ?? 0);
}

function sumRelinkResults(results: RelinkWarResult[], key: keyof RelinkWarResult): number {
  return results.reduce((total, result) => total + Number(result[key] ?? 0), 0);
}

const RELINK_ATTACK_MATCH_SQL = `
  (
    (
      a.attacker_faction_id = ${HOME_FACTION_ID}
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
    OR (
      w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
  )
`;

function parseExportOption<T extends readonly string[]>(
  value: string | null,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (!value) {
    return fallback;
  }

  return allowed.includes(value) ? value : fallback;
}

function exportWindowForWar(
  war: WarRow,
  windowMode: "official" | "practical" | "custom",
  url: URL,
): { start: number; finish: number } | Response {
  if (windowMode === "custom") {
    const start = Number(url.searchParams.get("custom_start"));
    const finish = Number(url.searchParams.get("custom_finish"));

    if (!Number.isInteger(start) || !Number.isInteger(finish) || start < 0 || finish < start) {
      return json(
        { ok: false, error: "Invalid custom export window", code: "INVALID_EXPORT_WINDOW" },
        400,
      );
    }

    return { start, finish };
  }

  let start =
    windowMode === "official"
      ? (war.official_start_time ?? war.practical_start_time)
      : war.practical_start_time;
  let finish =
    windowMode === "official"
      ? (war.official_end_time ?? war.practical_finish_time ?? nowSeconds())
      : (war.practical_finish_time ?? nowSeconds());
  const customStart = url.searchParams.get("custom_start");
  const customFinish = url.searchParams.get("custom_finish");

  if (customStart !== null && customStart.trim() !== "") {
    start = Number(customStart);
  }

  if (customFinish !== null && customFinish.trim() !== "") {
    finish = Number(customFinish);
  }

  if (!Number.isInteger(start) || !Number.isInteger(finish) || finish < start) {
    return json(
      { ok: false, error: "Selected export window is not available", code: "EXPORT_WINDOW_UNAVAILABLE" },
      400,
    );
  }

  return { start, finish };
}

const STANDARD_EXPORT_COLUMNS = [
  "id",
  "war_id",
  "started",
  "ended",
  "attacker_id",
  "attacker_name",
  "attacker_faction_id",
  "attacker_faction_name",
  "defender_id",
  "defender_name",
  "defender_faction_id",
  "defender_faction_name",
  "result",
  "respect_gain",
  "respect_loss",
  "chain",
  "m_retaliation",
] as const;

const DEBUG_EXPORT_COLUMNS = [
  ...STANDARD_EXPORT_COLUMNS,
  "code",
  "attacker_level",
  "defender_level",
  "is_interrupted",
  "is_stealthed",
  "is_raid",
  "is_ranked_war",
  "m_fair_fight",
  "m_war",
  "m_retaliation",
  "m_group",
  "m_overseas",
  "m_chain",
  "m_warlord",
  "fetched_at",
  "ingest_run_id",
] as const;

function attacksToCsv(
  rows: Record<string, unknown>[],
  columns: "standard" | "debug",
): string {
  const columnNames = columns === "debug" ? DEBUG_EXPORT_COLUMNS : STANDARD_EXPORT_COLUMNS;
  const lines = [
    columnNames.join(","),
    ...rows.map((row) => columnNames.map((column) => csvCell(row[column])).join(",")),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function sanitizeFilename(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "war-attacks";
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

function parseWarStatus(value: unknown): string {
  const status = value === undefined || value === null ? "" : String(value).trim().toLowerCase();

  if (!["scheduled", "active", "ended"].includes(status)) {
    throw new ValidationError("Invalid war status", "INVALID_STATUS");
  }

  return status;
}

function sanitizeWarName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 50);
  return name || "historical-war";
}

async function uniqueWarName(
  env: Env,
  baseName: string,
): Promise<string> {
  let candidate = baseName;
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const existing = await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(candidate)
      .first();

    if (!existing) {
      return candidate;
    }

    const suffixText = ` ${suffix + 1}`;
    candidate = `${baseName.slice(0, 50 - suffixText.length)}${suffixText}`;
  }

  const fallbackSuffix = ` ${nowSeconds()}`;
  return `${baseName.slice(0, 50 - fallbackSuffix.length)}${fallbackSuffix}`;
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

function optionalTimestampOrDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return Number.NaN;
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
