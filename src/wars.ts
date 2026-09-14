import {
  HOME_FACTION_ID,
  SOURCE_NAME,
  WAR_TYPES,
} from "./constants";
import {
  bumpWarCacheVersion,
} from "./cacheVersions";
import { setChainWatchEnabledForWar } from "./chainWatch";
import { parseEventCompetitionSettings, rescheduleEventCompetition } from "./eventCompetition";
import {
  ingestHistoricalWarWindow,
  previewHistoricalWarWindow,
  pullAttackWindow,
} from "./ingestion";
import { clearWarStats, finalizeWar, rebuildWarStatsFromRaw } from "./warStats";
import { applyRankedWarReport, fetchTornRankedWarReport } from "./reports";
import {
  WAR_RETURNING_COLUMNS,
} from "./sql";
import { Env, WarRow } from "./types";
import { json, nowSeconds } from "./utils";
import { readSyncState } from "./syncState";
import {
  clearCurrentWarState,
  endWarPractically,
  finishEventTracking,
  setWarPracticalWindow,
  setUpcomingWarState,
  startWarTracking,
} from "./warLifecycle";
export { exportWarAttacksCsv } from "./warExports";
export {
  getGlobalWarState,
  getOverallStats,
  getWar,
  getWarActivity,
  getWarAttacks,
  getWarChainBonusesForWar,
  getWarMemberCombatHeatmap,
  getWarMemberAttacks,
  listWars,
} from "./warQueries";
export { relinkWarAttacks } from "./warRelink";

type EventStatus = "scheduled" | "active" | "ended";

type EventMutationPayload = {
  event_type?: unknown;
  competition_refresh_hours?: unknown;
  name?: unknown;
  status?: unknown;
  practical_start_time?: unknown;
  start_time?: unknown;
  practical_finish_time?: unknown;
  finish_time?: unknown;
  fetch_missing?: unknown;
  chain_watch_enabled?: unknown;
};

type TrackerOverlapRow = {
  id: number;
  name: string;
  status: string;
  war_type: string | null;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_end_time: number | null;
};

const OPEN_ENDED_TIMESTAMP = 9_223_372_036_854_775_807;

async function saveEventCompetitionSettings(env: Env, warId: number, settings: ReturnType<typeof parseEventCompetitionSettings>): Promise<void> {
  await env.DB.prepare("UPDATE wars SET event_type = ?, competition_refresh_hours = ? WHERE id = ?")
    .bind(settings.eventType, settings.hours, warId).run();
}

export async function createManualEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as EventMutationPayload & { war_type?: unknown };
    const warType = parseWarType(body.war_type, "event");
    if (warType !== "event") {
      return json(
        {
          ok: false,
          error: "Manual war creation is disabled. Use this endpoint only for event trackers.",
          code: "MANUAL_WAR_CREATION_DISABLED",
        },
        410,
      );
    }

    const eventInput = parseEventInput(body, { requireName: true, requireFinishTime: false });
    const competition = parseEventCompetitionSettings(body);
    const chainWatchEnabled = parseEventChainWatchEnabled(body.chain_watch_enabled, false);
    const now = nowSeconds();
    const statusResult = resolveEventStatus(body.status, eventInput.startTime, eventInput.finishTime, now);
    if (statusResult instanceof Response) {
      return statusResult;
    }

    const overlap = await readTrackerOverlap(env, eventInput.startTime, eventInput.finishTime, null);
    if (overlap) {
      return trackerOverlapResponse(overlap);
    }

    const inserted = (await env.DB.prepare(
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
        chain_watch_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'event', NULL, 0, ?, NULL, NULL)
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(
        eventInput.name,
        statusResult === "active" ? "scheduled" : statusResult,
        eventInput.startTime,
        eventInput.finishTime,
        chainWatchEnabled ? 1 : 0,
      )
      .first()) as WarRow | null;

    if (!inserted) {
      throw new Error("Failed to create event");
    }

    await saveEventCompetitionSettings(env, inserted.id, competition);
    const importResult = await applyEventStatusSideEffects(env, {
      warId: inserted.id,
      name: inserted.name,
      status: statusResult,
      startTime: eventInput.startTime,
      finishTime: eventInput.finishTime,
      fetchMissing: parseOptionalBoolean(body.fetch_missing, "fetch_missing"),
      chainWatchEnabled,
    });
    const war = await readWarById(env, inserted.id);

    return json(
      {
        ok: true,
        war_id: inserted.id,
        name: inserted.name,
        war,
        status: war?.status ?? statusResult,
        practical_start_time: eventInput.startTime,
        practical_finish_time: eventInput.finishTime,
        ...importResult,
      },
      201,
    );
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function importHistoricalEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as EventMutationPayload;
    const competition = parseEventCompetitionSettings(body);
    const eventInput = parseEventInput(body, { requireName: true, requireFinishTime: true });
    const now = nowSeconds();

    if (eventInput.finishTime === null || eventInput.finishTime > now) {
      return json(
        {
          ok: false,
          error: "practical_finish_time must be in the past for historical event import",
          code: "FINISH_TIME_NOT_HISTORICAL",
        },
        400,
      );
    }

    const overlap = await readTrackerOverlap(env, eventInput.startTime, eventInput.finishTime, null);
    if (overlap) {
      return trackerOverlapResponse(overlap);
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
        chain_watch_enabled,
        faction_respect_limit,
        member_respect_limit
      )
      VALUES (?, 'ended', ?, ?, NULL, NULL, NULL, 'event', NULL, 0, 0, NULL, NULL)
      RETURNING
        ${WAR_RETURNING_COLUMNS}
      `,
    )
      .bind(eventInput.name, eventInput.startTime, eventInput.finishTime)
      .first()) as WarRow | null;

    if (!war) {
      throw new Error("Failed to create event");
    }

    await saveEventCompetitionSettings(env, war.id, competition);
    const importResult = await importEventAttackWindow(env, {
      warId: war.id,
      startTime: eventInput.startTime,
      finishTime: eventInput.finishTime,
      fetchMissing: parseOptionalBoolean(body.fetch_missing, "fetch_missing"),
    });

    await finalizeWar(env, war.id);
    await bumpWarCacheVersion(env, war.name);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        war: await readWarById(env, war.id),
        practical_start_time: eventInput.startTime,
        practical_finish_time: eventInput.finishTime,
        ...importResult,
      },
      201,
    );
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function previewHistoricalEventImport(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as EventMutationPayload;
    const eventInput = parseEventInput(body, { requireName: false, requireFinishTime: true });
    const fetchMissing = parseOptionalBoolean(body.fetch_missing, "fetch_missing");
    const overlap = await readTrackerOverlap(env, eventInput.startTime, eventInput.finishTime, null);
    if (overlap) {
      return trackerOverlapResponse(overlap);
    }

    const preview = fetchMissing
      ? await previewHistoricalWarWindow(env, eventInput.startTime, eventInput.finishTime!)
      : await previewStoredEventAttackWindow(env, eventInput.startTime, eventInput.finishTime!);

    return json({
      ok: true,
      fetch_missing: fetchMissing,
      practical_start_time: eventInput.startTime,
      practical_finish_time: eventInput.finishTime,
      duration_seconds: eventInput.finishTime! - eventInput.startTime,
      ...preview,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function updateEvent(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as EventMutationPayload & { id?: unknown };
    const warId = Number(body.id);
    if (!Number.isInteger(warId) || warId <= 0) {
      return json({ ok: false, error: "Invalid event id", code: "INVALID_WAR_ID" }, 400);
    }

    const existing = await readWarById(env, warId);
    if (!existing) {
      return json({ ok: false, error: "Event not found", code: "WAR_NOT_FOUND" }, 404);
    }

    if ((existing.war_type ?? "real") !== "event") {
      return json(
        { ok: false, error: "Use the war editor for real or termed wars", code: "WRONG_EDITOR" },
        400,
      );
    }

    const competition = parseEventCompetitionSettings(body, existing);
    if (competition.eventType !== (existing.event_type ?? "general")) {
      const captured = await env.DB.prepare("SELECT war_id FROM event_competition_state WHERE war_id = ?").bind(warId).first();
      if (captured) throw new ValidationError("Event type cannot change after collection starts", "EVENT_TYPE_LOCKED");
    }
    const hasFinish = hasEventFinishField(body);
    const chainWatchEnabled = parseEventChainWatchEnabled(
      body.chain_watch_enabled,
      existing.chain_watch_enabled === 1,
    );
    const eventInput = parseEventInput({
      ...body,
      name: body.name ?? existing.name,
      practical_start_time: body.practical_start_time ?? body.start_time ?? existing.practical_start_time,
      practical_finish_time: hasFinish
        ? body.practical_finish_time ?? body.finish_time
        : existing.practical_finish_time,
    }, { requireName: true, requireFinishTime: false });
    const now = nowSeconds();
    const statusResult = resolveEventStatus(
      body.status,
      eventInput.startTime,
      eventInput.finishTime,
      now,
    );
    if (statusResult instanceof Response) {
      return statusResult;
    }

    const overlap = await readTrackerOverlap(env, eventInput.startTime, eventInput.finishTime, warId);
    if (overlap) {
      return trackerOverlapResponse(overlap);
    }

    await env.DB.prepare(
      `
      UPDATE wars
      SET name = ?,
          status = ?,
          practical_start_time = ?,
          practical_finish_time = ?,
          official_start_time = NULL,
          official_end_time = NULL,
          enemy_faction_id = NULL,
          war_type = 'event',
          torn_war_id = NULL,
          auto_end_enabled = 0,
          chain_watch_enabled = ?,
          faction_respect_limit = NULL,
          member_respect_limit = NULL,
          finalized_at = CASE WHEN ? = 'ended' THEN finalized_at ELSE NULL END
      WHERE id = ?
      `,
    )
      .bind(
        eventInput.name,
        statusResult === "active" ? "scheduled" : statusResult,
        eventInput.startTime,
        eventInput.finishTime,
        chainWatchEnabled ? 1 : 0,
        statusResult,
        warId,
      )
      .run();

    await saveEventCompetitionSettings(env, warId, competition);
    if (competition.hours !== (existing.competition_refresh_hours ?? 6)) {
      await rescheduleEventCompetition(env, warId, competition.hours);
    }
    await unassignEventAttacksOutsideWindow(env, warId, eventInput.startTime, eventInput.finishTime);
    const importResult = await applyEventStatusSideEffects(env, {
      warId,
      name: eventInput.name,
      status: statusResult,
      startTime: eventInput.startTime,
      finishTime: eventInput.finishTime,
      fetchMissing: parseOptionalBoolean(body.fetch_missing, "fetch_missing"),
      chainWatchEnabled,
    });
    const updatedWar = await readWarById(env, warId);

    return json({
      ok: true,
      war: updatedWar,
      ...importResult,
    });
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
      official_end_time?: unknown;
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
      body.official_end_time ?? body.official_finish_time,
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
        { ok: false, error: "Invalid official_end_time", code: "INVALID_OFFICIAL_END_TIME" },
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
          error: "official_end_time must be greater than or equal to official_start_time",
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
          error: "official_end_time cannot be in the future for historical import",
          code: "OFFICIAL_FINISH_TIME_IN_FUTURE",
        },
        400,
      );
    }

    const syncState = await readSyncState(env, SOURCE_NAME);
    const openWar = syncState?.war_state !== "none" && syncState?.active_war_id
      ? ((await env.DB.prepare(
        `
        SELECT id, name
        FROM wars
        WHERE id = ?
        LIMIT 1
        `,
      )
        .bind(syncState.active_war_id)
        .first()) as { id: number; name: string } | null)
      : null;

    if (openWar) {
      return json(
        {
          ok: false,
          error: "Cannot import a historical war while another war is open",
          code: "ACTIVE_WAR_EXISTS",
          active_war: openWar,
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
    await bumpWarCacheVersion(env, war.name);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        practical_start_time: startTime,
        practical_finish_time: finishTime,
        official_start_time: officialStartTime,
        official_end_time: officialFinishTime,
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
      official_end_time?: unknown;
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
      body.official_end_time ?? body.official_finish_time,
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
        { ok: false, error: "Invalid official_end_time", code: "INVALID_OFFICIAL_END_TIME" },
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
          error: "official_end_time must be greater than or equal to official_start_time",
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
      official_end_time: officialFinishTime,
      duration_seconds: finishTime - startTime,
      official_duration_seconds: officialFinishTime - officialStartTime,
      ...preview,
    });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function updateOfficialWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      practical_start_time?: unknown;
      practical_finish_time?: unknown;
      war_type?: unknown;
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
      SELECT id, practical_start_time, enemy_faction_id, war_type
      FROM wars
      WHERE id = ?
      LIMIT 1
      `,
    )
      .bind(warId)
      .first()) as {
      id: number;
      practical_start_time: number;
      enemy_faction_id: number | null;
      war_type: (typeof WAR_TYPES)[number] | null;
    } | null;

    if (!existing) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    if ((existing.war_type ?? "real") === "event") {
      return json(
        { ok: false, error: "Use the event editor for event records", code: "WRONG_EDITOR" },
        400,
      );
    }

    const warType = parseWarType(body.war_type, existing.war_type ?? "real");
    if (warType === "event") {
      return json(
        { ok: false, error: "Current and historical war edits only support real or termed wars", code: "INVALID_WAR_TYPE" },
        400,
      );
    }

    const practicalStartTime = Number(body.practical_start_time);
    const practicalFinishTime = parseOptionalInteger(
      body.practical_finish_time,
      "practical_finish_time",
    );
    const factionRespectLimit = parseOptionalNonNegativeNumber(
      body.faction_respect_limit,
      "faction_respect_limit",
    );
    const memberRespectLimit = parseOptionalNonNegativeNumber(
      body.member_respect_limit,
      "member_respect_limit",
    );
    const autoEndEnabled = parseOptionalBoolean(body.auto_end_enabled) ? 1 : 0;
    const validationError = validateTermedWarFields(
      warType,
      autoEndEnabled,
      factionRespectLimit,
      memberRespectLimit,
    );
    if (validationError) {
      return validationError;
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

    const war = await setWarPracticalWindow(env, {
      warId,
      practicalStartTime,
      practicalFinishTime,
      enemyFactionId: existing.enemy_faction_id,
      warType,
      autoEndEnabled,
      factionRespectLimit,
      memberRespectLimit,
    });

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

    const syncState = await readSyncState(env, SOURCE_NAME);

    await clearWarStats(env, war.id);

    await env.DB.batch([
      env.DB.prepare(`UPDATE attacks SET war_id = NULL WHERE war_id = ?`).bind(war.id),
      env.DB.prepare(`DELETE FROM wars WHERE id = ?`).bind(war.id),
    ]);

    if (syncState?.active_war_id === war.id) {
      await clearCurrentWarState(env);
    }
    await bumpWarCacheVersion(env, war.name);

    return json({ ok: true, deleted_war: war });
  } catch (err: any) {
    return handleMutationError(err);
  }
}

export async function endActiveWar(request: Request, env: Env): Promise<Response> {
  let requestedFinishTime: number | null = null;

  try {
    const rawBody = await request.text();
    if (rawBody.trim() !== "") {
      const body = JSON.parse(rawBody) as { practical_finish_time?: unknown };
      requestedFinishTime = parseOptionalInteger(
        body.practical_finish_time,
        "practical_finish_time",
      );
    }
  } catch (err: any) {
    return handleMutationError(err);
  }

  const syncState = await readSyncState(env, SOURCE_NAME);
  const activeWarId = syncState?.war_state === "current" ? syncState.active_war_id : null;
  if (!activeWarId) {
    return json({ ok: false, error: "No current war" }, 400);
  }

  const activeWar = (await env.DB.prepare(
    `
    SELECT practical_start_time, enemy_faction_id, war_type
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(activeWarId)
    .first()) as {
    practical_start_time: number;
    enemy_faction_id: number | null;
    war_type: string | null;
  } | null;

  if (!activeWar) {
    return json({ ok: false, error: "Current war not found", code: "WAR_NOT_FOUND" }, 404);
  }

  const now = nowSeconds();
  const endedAt = requestedFinishTime ?? now;

  if (!Number.isInteger(endedAt) || endedAt < 0) {
    return json(
      { ok: false, error: "Invalid practical_finish_time", code: "INVALID_FINISH_TIME" },
      400,
    );
  }

  if (endedAt < activeWar.practical_start_time) {
    return json(
      {
        ok: false,
        error: "practical_finish_time must be greater than or equal to practical_start_time",
        code: "INVALID_TIME_RANGE",
      },
      400,
    );
  }

  if (endedAt > now) {
    return json(
      {
        ok: false,
        error: "practical_finish_time cannot be in the future",
        code: "FINISH_TIME_IN_FUTURE",
      },
      400,
    );
  }

  if ((activeWar.war_type ?? "real") === "event") {
    await finishEventTracking(env, {
      warId: activeWarId,
      finishAt: endedAt,
    });
  } else {
    await endWarPractically(env, {
      warId: activeWarId,
      finishAt: endedAt,
      enemyFactionId: activeWar.enemy_faction_id,
    });
  }

  return json({ ok: true, war_id: activeWarId, practical_finish_time: endedAt });
}

async function readWarById(env: Env, warId: number): Promise<WarRow | null> {
  return (await env.DB.prepare(
    `
    SELECT
      ${WAR_RETURNING_COLUMNS}
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as WarRow | null;
}

function parseEventInput(
  body: EventMutationPayload,
  options: { requireName: boolean; requireFinishTime: boolean },
): { name: string; startTime: number; finishTime: number | null } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (options.requireName && !name) {
    throw new ValidationError("Event name is required", "MISSING_EVENT_NAME");
  }

  if (name && !/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
    throw new ValidationError("Invalid event name", "INVALID_NAME");
  }

  const startTime = Number(body.practical_start_time ?? body.start_time);
  const finishTime = parseOptionalInteger(
    body.practical_finish_time ?? body.finish_time,
    "practical_finish_time",
  );

  if (!Number.isInteger(startTime) || startTime < 0) {
    throw new ValidationError("Invalid practical_start_time", "INVALID_START_TIME");
  }

  if (options.requireFinishTime && finishTime === null) {
    throw new ValidationError("practical_finish_time is required", "MISSING_FINISH_TIME");
  }

  if (finishTime !== null && finishTime < startTime) {
    throw new ValidationError(
      "practical_finish_time must be greater than or equal to practical_start_time",
      "INVALID_TIME_RANGE",
    );
  }

  return { name, startTime, finishTime };
}

function hasEventFinishField(body: EventMutationPayload): boolean {
  return Object.prototype.hasOwnProperty.call(body, "practical_finish_time") ||
    Object.prototype.hasOwnProperty.call(body, "finish_time");
}

function resolveEventStatus(
  value: unknown,
  startTime: number,
  finishTime: number | null,
  now: number,
): EventStatus | Response {
  const rawStatus =
    value === undefined || value === null || value === ""
      ? null
      : String(value).trim().toLowerCase();
  const status = rawStatus === null
    ? finishTime !== null && finishTime <= now
      ? "ended"
      : startTime > now
        ? "scheduled"
        : "active"
    : rawStatus;

  if (status !== "scheduled" && status !== "active" && status !== "ended") {
    return json({ ok: false, error: "Invalid event status", code: "INVALID_STATUS" }, 400);
  }

  if (status === "scheduled" && startTime <= now) {
    return json(
      {
        ok: false,
        error: "Scheduled events must start in the future",
        code: "SCHEDULED_START_NOT_FUTURE",
      },
      400,
    );
  }

  if (status === "active" && startTime > now) {
    return json(
      {
        ok: false,
        error: "Active events cannot start in the future",
        code: "ACTIVE_START_IN_FUTURE",
      },
      400,
    );
  }

  if (status === "active" && finishTime !== null && finishTime <= now) {
    return json(
      {
        ok: false,
        error: "Active events cannot have a finish time in the past",
        code: "ACTIVE_FINISH_IN_PAST",
      },
      400,
    );
  }

  if (status === "ended" && (finishTime === null || finishTime > now)) {
    return json(
      {
        ok: false,
        error: "Ended events require a finish time in the past",
        code: "ENDED_FINISH_NOT_PAST",
      },
      400,
    );
  }

  return status;
}

async function applyEventStatusSideEffects(
  env: Env,
  options: {
    warId: number;
    name: string;
    status: EventStatus;
    startTime: number;
    finishTime: number | null;
    fetchMissing: boolean;
    chainWatchEnabled: boolean;
  },
): Promise<{
  fetch_missing?: boolean;
  imported_attack_count?: number;
  linked_attack_count?: number;
}> {
  if (options.status === "scheduled") {
    await refreshUpcomingTrackerState(env);
    await bumpWarCacheVersion(env, options.name);
    return {};
  }

  if (options.status === "active") {
    await startWarTracking(env, {
      warId: options.warId,
      startedAt: options.startTime,
    });
    if (!options.chainWatchEnabled) {
      await setChainWatchEnabledForWar(env, options.warId, false, {
        warName: options.name,
      });
    }
    const linkedAttackCount = await linkStoredEventAttacks(
      env,
      options.warId,
      options.startTime,
      options.finishTime,
    );
    if (linkedAttackCount > 0) {
      await rebuildWarStatsFromRaw(env, {
        scope: "single-war",
        warId: options.warId,
        reason: "relink",
      });
    }
    await bumpWarCacheVersion(env, options.name);
    return { linked_attack_count: linkedAttackCount };
  }

  const importResult = await importEventAttackWindow(env, {
    warId: options.warId,
    startTime: options.startTime,
    finishTime: options.finishTime!,
    fetchMissing: options.fetchMissing,
  });
  await finishEventTracking(env, {
    warId: options.warId,
    finishAt: options.finishTime!,
  });
  await bumpWarCacheVersion(env, options.name);
  return importResult;
}

async function importEventAttackWindow(
  env: Env,
  options: {
    warId: number;
    startTime: number;
    finishTime: number;
    fetchMissing: boolean;
  },
): Promise<{
  fetch_missing: boolean;
  imported_attack_count: number;
  linked_attack_count: number;
}> {
  const importedAttackCount = options.fetchMissing
    ? await ingestHistoricalWarWindow(env, options.warId, options.startTime, options.finishTime)
    : 0;
  const linkedAttackCount = await linkStoredEventAttacks(
    env,
    options.warId,
    options.startTime,
    options.finishTime,
  );

  return {
    fetch_missing: options.fetchMissing,
    imported_attack_count: importedAttackCount,
    linked_attack_count: linkedAttackCount,
  };
}

async function previewStoredEventAttackWindow(
  env: Env,
  startTime: number,
  finishTime: number,
): Promise<{
  matching_attack_count: number;
  first_attack_started: number | null;
  last_attack_started: number | null;
  sampled_attacks: Array<{
    id: number;
    started: number | null;
    attacker_name: string | null;
    attacker_faction_id: number | null;
    defender_name: string | null;
    defender_faction_id: number | null;
    result: string | null;
    respect_gain: number;
  }>;
}> {
  const row = (await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS matching_attack_count,
      MIN(started) AS first_attack_started,
      MAX(started) AS last_attack_started
    FROM attacks
    WHERE ${EVENT_ATTACK_WINDOW_SQL}
    `,
  )
    .bind(startTime, finishTime)
    .first()) as {
    matching_attack_count: number;
    first_attack_started: number | null;
    last_attack_started: number | null;
  } | null;
  const sampleRows = await env.DB.prepare(
    `
    SELECT
      id,
      started,
      attacker_name,
      attacker_faction_id,
      defender_name,
      defender_faction_id,
      result,
      respect_gain
    FROM attacks
    WHERE ${EVENT_ATTACK_WINDOW_SQL}
    ORDER BY started ASC, id ASC
    LIMIT 10
    `,
  )
    .bind(startTime, finishTime)
    .all();

  return {
    matching_attack_count: Number(row?.matching_attack_count ?? 0),
    first_attack_started: row?.first_attack_started ?? null,
    last_attack_started: row?.last_attack_started ?? null,
    sampled_attacks: ((sampleRows.results ?? []) as any[]).map((attack) => ({
      id: Number(attack.id),
      started: attack.started === null ? null : Number(attack.started),
      attacker_name: attack.attacker_name ?? null,
      attacker_faction_id: attack.attacker_faction_id === null ? null : Number(attack.attacker_faction_id),
      defender_name: attack.defender_name ?? null,
      defender_faction_id: attack.defender_faction_id === null ? null : Number(attack.defender_faction_id),
      result: attack.result ?? null,
      respect_gain: Number(attack.respect_gain ?? 0),
    })),
  };
}

async function linkStoredEventAttacks(
  env: Env,
  warId: number,
  startTime: number,
  finishTime: number | null,
): Promise<number> {
  const result = await env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = ?
    WHERE war_id IS NULL
      AND ${EVENT_ATTACK_WINDOW_SQL}
    `,
  )
    .bind(warId, startTime, finishTime ?? OPEN_ENDED_TIMESTAMP)
    .run();

  return Number(result.meta?.changes ?? 0);
}

async function unassignEventAttacksOutsideWindow(
  env: Env,
  warId: number,
  startTime: number,
  finishTime: number | null,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = NULL
    WHERE war_id = ?
      AND (
        started IS NULL
        OR started < ?
        OR COALESCE(ended, started) > ?
        OR NOT (
          attacker_faction_id = ${HOME_FACTION_ID}
          OR defender_faction_id = ${HOME_FACTION_ID}
        )
      )
    `,
  )
    .bind(warId, startTime, finishTime ?? OPEN_ENDED_TIMESTAMP)
    .run();
}

async function readTrackerOverlap(
  env: Env,
  startTime: number,
  finishTime: number | null,
  excludeWarId: number | null,
): Promise<TrackerOverlapRow | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      status,
      war_type,
      practical_start_time,
      practical_finish_time,
      official_end_time
    FROM wars
    WHERE (? IS NULL OR id != ?)
      AND practical_start_time <= ?
      AND COALESCE(practical_finish_time, official_end_time, ?) >= ?
    ORDER BY practical_start_time ASC, id ASC
    LIMIT 1
    `,
  )
    .bind(
      excludeWarId,
      excludeWarId,
      finishTime ?? OPEN_ENDED_TIMESTAMP,
      OPEN_ENDED_TIMESTAMP,
      startTime,
    )
    .first()) as TrackerOverlapRow | null;
}

function trackerOverlapResponse(overlap: TrackerOverlapRow): Response {
  return json(
    {
      ok: false,
      error: `Event overlaps ${trackerTypeLabel(overlap)} ${overlap.name}`,
      code: "TRACKER_OVERLAP",
      overlap,
    },
    400,
  );
}

function trackerTypeLabel(war: { war_type: string | null }): string {
  return (war.war_type ?? "real") === "event" ? "event" : "war";
}

function parseEventChainWatchEnabled(value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null || value === ""
    ? fallback
    : parseOptionalBoolean(value, "chain_watch_enabled");
}

async function refreshUpcomingTrackerState(env: Env): Promise<void> {
  const currentState = await readSyncState(env, SOURCE_NAME);
  if (currentState?.war_state === "current") {
    return;
  }

  const scheduledWar = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE status = 'scheduled'
    ORDER BY practical_start_time ASC, id ASC
    LIMIT 1
    `,
  ).first()) as { id: number } | null;

  if (scheduledWar) {
    await setUpcomingWarState(env, scheduledWar.id);
    return;
  }

  await clearCurrentWarState(env);
}

const EVENT_ATTACK_WINDOW_SQL = `
  started >= ?
  AND COALESCE(ended, started) <= ?
  AND (
    attacker_faction_id = ${HOME_FACTION_ID}
    OR defender_faction_id = ${HOME_FACTION_ID}
  )
`;

function handleMutationError(err: any): Response {
  if (err instanceof ValidationError) {
    return json({ ok: false, error: err.message, code: err.code }, 400);
  }

  const message = err?.message || String(err);
  if (message.startsWith("Event type must") || message.startsWith("Competition refresh must")) {
    return json({ ok: false, error: message, code: "INVALID_EVENT_COMPETITION" }, 400);
  }

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

function parseOptionalBoolean(value: unknown, field = "auto_end_enabled"): boolean {
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

  throw new ValidationError(`Invalid ${field}`, `INVALID_${field.toUpperCase()}`);
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


