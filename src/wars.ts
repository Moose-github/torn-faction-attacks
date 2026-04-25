import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { backfillWarAssignments, ingestHistoricalWarWindow, setActiveWarState } from "./ingestion";
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
    const warType =
      body.war_type === undefined || body.war_type === null
        ? null
        : String(body.war_type).trim() || null;

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
      INSERT INTO wars (name, status, start_time, faction_id, war_type)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id, name, status, start_time, finish_time, faction_id, war_type, finalized_at
      `,
    )
      .bind(name, status, startTime, factionId, warType)
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
    const warType =
      body.war_type === undefined || body.war_type === null
        ? null
        : String(body.war_type).trim() || null;
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
      INSERT INTO wars (name, status, start_time, finish_time, faction_id, war_type)
      VALUES (?, 'ended', ?, ?, ?, ?)
      RETURNING id, name, status, start_time, finish_time, faction_id, war_type, finalized_at
      `,
    )
      .bind(name, startTime, finishTime, factionId, warType)
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

export async function listWars(env: Env): Promise<Response> {
  try {
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
      ORDER BY w.start_time DESC
      `,
    ).all();

    return json({ ok: true, wars: rows.results ?? [] });
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
      SELECT id, name, status, start_time, finish_time, faction_id, war_type, finalized_at
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
      ORDER BY respect_gain DESC, attacks_made DESC
      `,
    )
      .bind(war.id)
      .all();

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
      summary,
      members: memberStats.results ?? [],
      attacks: attacks.results ?? [],
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function getOverallStats(env: Env): Promise<Response> {
  const overall = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total_wars,
      COALESCE(SUM(faction_attacks), 0) AS faction_attacks,
      COALESCE(SUM(enemy_attacks), 0) AS enemy_attacks,
      COALESCE(SUM(outside_hits_outgoing), 0) AS outside_hits_outgoing,
      COALESCE(SUM(total_respect_gain), 0) AS total_respect_gain,
      COALESCE(SUM(total_respect_lost), 0) AS total_respect_lost,
      MAX(last_attack_at) AS latest_attack_started
    FROM war_summary
    `,
  ).first();

  const topMembers = await env.DB.prepare(
    `
    SELECT *
    FROM member_career_stats
    ORDER BY respect_gain DESC, attacks_made DESC
    LIMIT 25
    `,
  ).all();

  return json({
    ok: true,
    overall,
    top_members: topMembers.results ?? [],
  });
}

function handleMutationError(err: any): Response {
  const message = err?.message || String(err);

  if (message.includes("Unexpected token")) {
    return json({ ok: false, error: "Invalid JSON body", code: "INVALID_JSON" }, 400);
  }

  if (message.includes("UNIQUE constraint failed: wars.name")) {
    return json({ ok: false, error: "War name already exists", code: "WAR_NAME_EXISTS" }, 400);
  }

  return json({ ok: false, error: message, code: "INTERNAL_ERROR" }, 500);
}
