import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { backfillWarAssignments, ingestHistoricalWarWindow, setActiveWarState } from "./ingestion";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw } from "./summaries";
import { Env, WarRow, WarSummaryRow } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

export async function createWar(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      name?: unknown;
      started_at?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    const now = nowSeconds();
    let startedAt = now;

    if (body.started_at !== undefined) {
      const parsed = Number(body.started_at);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return json({ ok: false, error: "Invalid started_at", code: "INVALID_STARTED_AT" }, 400);
      }
      startedAt = parsed;
    }

    const status = startedAt > now ? "scheduled" : "active";

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
      `SELECT id, name, started_at FROM wars WHERE status = 'scheduled' LIMIT 1`,
    ).first()) as { id: number; name: string; started_at: number } | null;

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
      INSERT INTO wars (name, status, started_at)
      VALUES (?, ?, ?)
      RETURNING id, name, status, started_at, ended_at, finalized_at
      `,
    )
      .bind(name, status, startedAt)
      .first()) as WarRow | null;

    if (status === "active" && war) {
      await setActiveWarState(env, war.id, startedAt);
      await backfillWarAssignments(env, war.id, startedAt);
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
      started_at?: unknown;
      ended_at?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
      return json({ ok: false, error: "Invalid war name", code: "INVALID_NAME" }, 400);
    }

    const startedAt = Number(body.started_at);
    const endedAt = Number(body.ended_at);
    const now = nowSeconds();

    if (!Number.isInteger(startedAt) || startedAt < 0) {
      return json({ ok: false, error: "Invalid started_at", code: "INVALID_STARTED_AT" }, 400);
    }

    if (!Number.isInteger(endedAt) || endedAt < 0) {
      return json({ ok: false, error: "Invalid ended_at", code: "INVALID_ENDED_AT" }, 400);
    }

    if (endedAt < startedAt) {
      return json(
        {
          ok: false,
          error: "ended_at must be greater than or equal to started_at",
          code: "INVALID_TIME_RANGE",
        },
        400,
      );
    }

    if (endedAt > now) {
      return json(
        {
          ok: false,
          error: "ended_at cannot be in the future for historical import",
          code: "ENDED_AT_IN_FUTURE",
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
      INSERT INTO wars (name, status, started_at, ended_at)
      VALUES (?, 'ended', ?, ?)
      RETURNING id, name, status, started_at, ended_at, finalized_at
      `,
    )
      .bind(name, startedAt, endedAt)
      .first()) as WarRow | null;

    if (!war) {
      throw new Error("Failed to create war");
    }

    const importedAttackCount = await ingestHistoricalWarWindow(env, war.id, startedAt, endedAt);
    await finalizeWar(env, war.id);

    return json(
      {
        ok: true,
        war_id: war.id,
        name: war.name,
        started_at: startedAt,
        ended_at: endedAt,
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
    SET status = 'ended', ended_at = ?
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

  return json({ ok: true, war_id: activeWarId, ended_at: endedAt });
}

export async function listWars(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `
      SELECT
        w.id,
        w.name,
        w.status,
        w.started_at,
        w.ended_at,
        w.finalized_at,
        COALESCE(ws.total_attacks, 0) AS total_attacks,
        COALESCE(ws.total_respect_gain, 0) AS total_respect_gain,
        COALESCE(ws.total_respect_lost, 0) AS total_respect_lost,
        COALESCE(ws.unique_attackers, 0) AS unique_attackers,
        COALESCE(ws.unique_members_lost_defends, 0) AS unique_members_lost_defends,
        ws.first_attack_at,
        ws.last_attack_at,
        ws.updated_at AS summary_updated_at
      FROM wars w
      LEFT JOIN war_summary ws ON ws.war_id = w.id
      ORDER BY w.started_at DESC
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
      SELECT id, name, status, started_at, ended_at, finalized_at
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
      COALESCE(SUM(total_attacks), 0) AS total_attacks,
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
