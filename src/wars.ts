import {
  HOME_FACTION_ID,
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
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromMemberStats } from "./summaries";
import { applyRankedWarReport, fetchTornRankedWarReport } from "./reports";
import {
  WAR_RETURNING_COLUMNS,
} from "./sql";
import { Env, WarRow } from "./types";
import { json, nowSeconds } from "./utils";
export { exportWarAttacksCsv } from "./warExports";
export {
  getOverallStats,
  getWar,
  getWarActivity,
  getWarAttacks,
  getWarChainBonusesForWar,
  getWarMemberAttacks,
  listWars,
} from "./warQueries";
export { relinkWarAttacks } from "./warRelink";

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
    const warType = parseWarType(body.war_type, "event");
    if (warType !== "event") {
      return json(
        {
          ok: false,
          error: "Official wars are auto-created from Torn or imported after they finish",
          code: "MANUAL_OFFICIAL_WAR_DISABLED",
        },
        400,
      );
    }

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
        null,
        0,
        null,
        null,
      )
      .first()) as WarRow | null;

    if (status === "active" && war) {
      await setActiveWarState(env, war.id, startTime);
      await backfillWarAssignments(env, war.id, startTime);
      await rebuildWarMemberStatsFromRaw(env, war.id);
      await rebuildWarSummaryFromMemberStats(env, war.id);
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
    if (warType === "event") {
      return json(
        {
          ok: false,
          error: "Use /api/wars/import-event for historical event imports",
          code: "WRONG_IMPORT_ENDPOINT",
        },
        400,
      );
    }

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

export async function importHistoricalEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      practical_start_time?: unknown;
      start_time?: unknown;
      practical_finish_time?: unknown;
      finish_time?: unknown;
      enemy_faction_id?: unknown;
      faction_id?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const startTime = Number(body.practical_start_time ?? body.start_time);
    const finishTime = Number(body.practical_finish_time ?? body.finish_time);
    const enemyFactionValue = body.enemy_faction_id ?? body.faction_id;
    const enemyFactionId =
      enemyFactionValue === undefined || enemyFactionValue === null || enemyFactionValue === ""
        ? null
        : Number(enemyFactionValue);
    const now = nowSeconds();

    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid event name", code: "INVALID_NAME" }, 400);
    }

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

    if (finishTime > now) {
      return json(
        {
          ok: false,
          error: "practical_finish_time cannot be in the future for historical event import",
          code: "FINISH_TIME_IN_FUTURE",
        },
        400,
      );
    }

    if (enemyFactionId !== null && (!Number.isInteger(enemyFactionId) || enemyFactionId < 0)) {
      return json({ ok: false, error: "Invalid enemy_faction_id", code: "INVALID_FACTION_ID" }, 400);
    }

    const eventName = await uniqueWarName(env, sanitizeWarName(name));
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
      VALUES (?, 'ended', ?, ?, NULL, NULL, ?, 'event', NULL, 0, NULL, NULL)
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(eventName, startTime, finishTime, enemyFactionId)
      .first()) as WarRow | null;

    if (!war) {
      throw new Error("Failed to create event");
    }

    const importedAttackCount = await ingestHistoricalWarWindow(
      env,
      war.id,
      startTime,
      finishTime,
    );
    await finalizeWar(env, war.id);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        practical_start_time: startTime,
        practical_finish_time: finishTime,
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
    if (warType === "event") {
      return json(
        {
          ok: false,
          error: "Use /api/wars/import-event/preview for historical event previews",
          code: "WRONG_IMPORT_ENDPOINT",
        },
        400,
      );
    }

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

export async function previewHistoricalEventImport(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      practical_start_time?: unknown;
      start_time?: unknown;
      practical_finish_time?: unknown;
      finish_time?: unknown;
    };

    const startTime = Number(body.practical_start_time ?? body.start_time);
    const finishTime = Number(body.practical_finish_time ?? body.finish_time);

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

    const preview = await previewHistoricalWarWindow(env, startTime, finishTime);

    return json({
      ok: true,
      practical_start_time: startTime,
      practical_finish_time: finishTime,
      duration_seconds: finishTime - startTime,
      ...preview,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

type UpdateWarMode = "official" | "event";

export async function updateOfficialWar(request: Request, env: Env): Promise<Response> {
  return updateWarInternal(request, env, "official");
}

export async function updateEvent(request: Request, env: Env): Promise<Response> {
  return updateWarInternal(request, env, "event");
}

async function updateWarInternal(
  request: Request,
  env: Env,
  mode: UpdateWarMode,
): Promise<Response> {
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
      SELECT
        id,
        name,
        official_start_time,
        official_end_time,
        enemy_faction_id,
        war_type,
        torn_war_id
      FROM wars
      WHERE id = ?
      LIMIT 1
      `,
    )
      .bind(warId)
      .first()) as {
      id: number;
      name: string;
      official_start_time: number | null;
      official_end_time: number | null;
      enemy_faction_id: number | null;
      war_type: (typeof WAR_TYPES)[number] | null;
      torn_war_id: number | null;
    } | null;

    if (!existing) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const existingWarType = existing.war_type ?? "real";
    let name = existing.name;

    const status = parseWarStatus(body.status);
    const practicalStartTime = Number(body.practical_start_time);
    const practicalFinishTime = parseOptionalInteger(
      body.practical_finish_time,
      "practical_finish_time",
    );
    let officialStartTime = parseOptionalInteger(body.official_start_time, "official_start_time");
    let officialFinishTime = parseOptionalInteger(
      body.official_finish_time ?? body.official_end_time,
      "official_finish_time",
    );
    let warType = parseWarType(body.war_type, existingWarType);
    let enemyFactionId = parseOptionalInteger(body.enemy_faction_id, "enemy_faction_id");
    let tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    let autoEndEnabled = parseOptionalBoolean(body.auto_end_enabled) ? 1 : 0;
    let factionRespectLimit = parseOptionalNonNegativeNumber(
      body.faction_respect_limit,
      "faction_respect_limit",
    );
    let memberRespectLimit = parseOptionalNonNegativeNumber(
      body.member_respect_limit,
      "member_respect_limit",
    );

    if (mode === "official") {
      if (existingWarType === "event" || warType === "event") {
        return json(
          { ok: false, error: "Use the event editor for event records", code: "WRONG_EDITOR" },
          400,
        );
      }
    }

    if (mode === "event") {
      if (existingWarType !== "event") {
        return json(
          { ok: false, error: "Use the official war editor for Torn-backed wars", code: "WRONG_EDITOR" },
          400,
        );
      }

      warType = "event";
      name = typeof body.name === "string" ? body.name.trim() : existing.name;
      if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
        return json({ ok: false, error: "Invalid event name", code: "INVALID_NAME" }, 400);
      }
    }

    if (warType === "real" || warType === "termed") {
      officialStartTime = existing.official_start_time;
      officialFinishTime = existing.official_end_time;
      enemyFactionId = existing.enemy_faction_id;
      tornWarId = existing.torn_war_id;
    } else {
      officialStartTime = null;
      officialFinishTime = null;
      tornWarId = null;
      autoEndEnabled = 0;
      factionRespectLimit = null;
      memberRespectLimit = null;
    }

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

    await rebuildWarMemberStatsFromRaw(env, warId);
    await rebuildWarSummaryFromMemberStats(env, warId);

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


