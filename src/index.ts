export interface Env {
  DB: D1Database;
  TORN_API_KEY: string;
}

type D1Database = any;
type D1PreparedStatement = any;
type ScheduledController = any;
type ExecutionContext = any;

const SOURCE_NAME = "attacks";
const API_URL = "https://api.torn.com/v2/faction/attacks";
const LIMIT = 100;
const OVERLAP_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/run") {
      await runIngestion(env);
      return json({ ok: true });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/attacks") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
      const rows = await env.DB.prepare(`SELECT * FROM attacks ORDER BY started DESC LIMIT ?`)
        .bind(limit)
        .all();
      return json(rows.results ?? []);
    }

    if (url.pathname === "/api/wars" && request.method === "POST") {
      try {
        const body = await request.json() as {
          name?: unknown;
          started_at?: unknown;
        };
    
        const name = typeof body.name === "string" ? body.name.trim() : "";
    
        if (!/^[a-zA-Z0-9 _-]{1,50}$/.test(name)) {
          return json({
            ok: false,
            error: "Invalid war name",
            code: "INVALID_NAME"
          }, 400);
        }
    
        const now = Math.floor(Date.now() / 1000);
        let startedAt = now;
    
        if (body.started_at !== undefined) {
          const parsed = Number(body.started_at);
    
          if (!Number.isInteger(parsed) || parsed < 0) {
            return json({
              ok: false,
              error: "Invalid started_at",
              code: "INVALID_STARTED_AT"
            }, 400);
          }
    
          startedAt = parsed;
        }
    
        const status = startedAt > now ? "scheduled" : "active";
    
        const existingActiveWar = await env.DB.prepare(`
          SELECT id, name
          FROM wars
          WHERE status = 'active'
          LIMIT 1
        `).first() as { id: number; name: string } | null;
    
        if (status === "active" && existingActiveWar) {
          return json({
            ok: false,
            error: "Another war is already active",
            code: "ACTIVE_WAR_EXISTS",
            active_war: {
              id: existingActiveWar.id,
              name: existingActiveWar.name
            }
          }, 400);
        }
    
        const existingScheduledWar = await env.DB.prepare(`
          SELECT id, name, started_at
          FROM wars
          WHERE status = 'scheduled'
          LIMIT 1
        `).first() as { id: number; name: string; started_at: number } | null;
    
        if (status === "scheduled" && existingScheduledWar) {
          return json({
            ok: false,
            error: "Another war is already scheduled",
            code: "SCHEDULED_WAR_EXISTS",
            scheduled_war: {
              id: existingScheduledWar.id,
              name: existingScheduledWar.name,
              started_at: existingScheduledWar.started_at
            }
          }, 400);
        }
    
        const war = await env.DB.prepare(`
          INSERT INTO wars (name, status, started_at)
          VALUES (?, ?, ?)
          RETURNING id, name, status, started_at
        `).bind(name, status, startedAt).first() as {
          id: number;
          name: string;
          status: string;
          started_at: number;
        } | null;
    
        if (status === "active" && war) {
          await env.DB.prepare(`
            INSERT INTO sync_state (name, last_started, active_war_id, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(name) DO UPDATE SET
              last_started = excluded.last_started,
              active_war_id = excluded.active_war_id,
              updated_at = CURRENT_TIMESTAMP
          `).bind(SOURCE_NAME, startedAt, war.id).run();
        }
    
        return json({
          ok: true,
          war
        }, 201);
    
      } catch (err: any) {
        const message = err?.message || String(err);
    
        if (message.includes("Unexpected token")) {
          return json({
            ok: false,
            error: "Invalid JSON body",
            code: "INVALID_JSON"
          }, 400);
        }
    
        if (message.includes("UNIQUE constraint failed: wars.name")) {
          return json({
            ok: false,
            error: "War name already exists",
            code: "WAR_NAME_EXISTS"
          }, 400);
        }
    
        return json({
          ok: false,
          error: message,
          code: "INTERNAL_ERROR"
        }, 500);
      }
    }


    if (url.pathname === "/api/wars/end") {
      const state = (await env.DB.prepare(`SELECT active_war_id FROM sync_state WHERE name = ?`)
        .bind(SOURCE_NAME)
        .first()) as { active_war_id: number | null } | null;

      if (!state?.active_war_id) {
        return json({ error: "No active war" }, 400);
      }

      const now = Math.floor(Date.now() / 1000);

      await env.DB.prepare( `UPDATE wars SET status = 'ended', ended_at = ? WHERE id = ?`)
        .bind(now, state.active_war_id)
        .run();

      await env.DB.prepare(`UPDATE sync_state SET active_war_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE name = ?`)
        .bind(SOURCE_NAME)
        .run();

      return json({ ok: true });
    }

    if (url.pathname === "/api/wars") {
      try {
        const rows = await env.DB.prepare(`
          SELECT
            w.id,
            w.name,
            w.status,
            w.started_at,
            w.ended_at,
    
            COUNT(a.id) AS attack_count
    
          FROM wars w
          LEFT JOIN attacks a ON a.war_id = w.id
          GROUP BY w.id
          ORDER BY w.started_at DESC
        `).all();
    
        return json({
          ok: true,
          wars: rows.results ?? []
        });
    
      } catch (err: any) {
        return json({
          ok: false,
          error: err?.message || String(err),
          code: "INTERNAL_ERROR"
        }, 500);
      }
    }

    if (url.pathname.startsWith("/api/wars/") && url.pathname.endsWith("/attacks")) {
      try {
        const name = decodeURIComponent(url.pathname.split("/")[3]).trim();
    
        if (!name) {
          return json({
            ok: false,
            error: "Invalid war name",
            code: "INVALID_WAR_NAME"
          }, 400);
        }
    
        // 🔍 Find war by name
        const war = await env.DB.prepare(`SELECT id, name FROM wars WHERE LOWER(name) = LOWER(?) LIMIT 1 `)
          .bind(name).first() as { id: number; name: string } | null;
    
        if (!war) {
          return json({
            ok: false,
            error: "War not found",
            code: "WAR_NOT_FOUND"
          }, 404);
        }
    
        // Fetch attacks for war
        const rows = await env.DB.prepare(`
          SELECT *
          FROM attacks
          WHERE war_id = ?
          ORDER BY started DESC
          LIMIT 100
        `).bind(war.id).all();
    
        return json({
          ok: true,
          war,
          attacks: rows.results ?? []
        });
    
      } catch (err: any) {
        return json({
          ok: false,
          error: err?.message || String(err),
          code: "INTERNAL_ERROR"
        }, 500);
      }
    }

    if (url.pathname === "/api/stats") {
      const stats = await env.DB.prepare(
        `
        SELECT
          COUNT(*) AS total_attacks,
          COALESCE(SUM(respect_gain), 0) AS total_respect_gain,
          COALESCE(SUM(respect_loss), 0) AS total_respect_loss,
          MAX(started) AS latest_attack_started
        FROM attacks
      `
      ).first();

      return json(stats);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(event: any, env: Env, ctx: any): Promise<void> {
    ctx.waitUntil(
      runIngestion(env).catch((err) => {
        console.error("Cron ingestion failed:", err?.message || err);
        console.error(err);
      })
    );
  },
};

async function runIngestion(env: Env) {
  await ensureState(env);
  await activateScheduledWarIfDue(env);

  const state = (await env.DB.prepare(`SELECT last_started, active_war_id FROM sync_state WHERE name = ?`)
    .bind(SOURCE_NAME)
    .first()) as {
    last_started: number;
    active_war_id: number | null;
  } | null;

  const activeWarId = state?.active_war_id ?? null;

  let from = Math.max(0, (state?.last_started ?? 0) - OVERLAP_SECONDS);
  let newestStarted = state?.last_started ?? 0;

  while (true) {
    const data = await fetchAttacks(env, from);
    const attacks = data.attacks ?? [];
  
    if (attacks.length === 0) {
      break;
    }
  
    const statements: D1PreparedStatement[] = [];
    let pageNewestStarted = newestStarted;
  
    for (const attack of attacks) {
      pageNewestStarted = Math.max(pageNewestStarted, attack.started ?? 0);
  
      statements.push(
        env.DB.prepare(
          `
          INSERT INTO attacks (
            id,
            war_id,
            code,
            started,
            ended,
  
            attacker_id,
            attacker_name,
            attacker_level,
            attacker_faction_id,
            attacker_faction_name,
  
            defender_id,
            defender_name,
            defender_level,
            defender_faction_id,
            defender_faction_name,
  
            result,
            respect_gain,
            respect_loss,
            chain,
  
            is_interrupted,
            is_stealthed,
            is_raid,
            is_ranked_war,
  
            m_fair_fight,
            m_war,
            m_retaliation,
            m_group,
            m_overseas,
            m_chain,
            m_warlord,
  
            fetched_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO NOTHING
          `
        ).bind(
          attack.id,
          activeWarId,
          attack.code ?? null,
          attack.started ?? null,
          attack.ended ?? null,
  
          attack.attacker?.id ?? null,
          attack.attacker?.name ?? null,
          attack.attacker?.level ?? null,
          attack.attacker?.faction?.id ?? null,
          attack.attacker?.faction?.name ?? null,
  
          attack.defender?.id ?? null,
          attack.defender?.name ?? null,
          attack.defender?.level ?? null,
          attack.defender?.faction?.id ?? null,
          attack.defender?.faction?.name ?? null,
  
          attack.result ?? null,
          attack.respect_gain ?? 0,
          attack.respect_loss ?? 0,
          attack.chain ?? null,
          boolToInt(attack.is_interrupted),
          boolToInt(attack.is_stealthed),
          boolToInt(attack.is_raid),
          boolToInt(attack.is_ranked_war),
          attack.modifiers?.fair_fight ?? 1,
          attack.modifiers?.war ?? 1,
          attack.modifiers?.retaliation ?? 1,
          attack.modifiers?.group ?? 1,
          attack.modifiers?.overseas ?? 1,
          attack.modifiers?.chain ?? 1,
          attack.modifiers?.warlord ?? 1
        )
      );
    }
  
    if (statements.length > 0) {
      await env.DB.batch(statements);
    }
  
    newestStarted = pageNewestStarted;
  
    await env.DB.prepare(
      `
      INSERT INTO sync_state (name, last_started, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        last_started = excluded.last_started,
        updated_at = CURRENT_TIMESTAMP
      `
    )
      .bind(SOURCE_NAME, newestStarted)
      .run();
  
    if (attacks.length < LIMIT) {
      break;
    }
  
    from = newestStarted;
  }

}

async function fetchAttacks(
  env: Env,
  from: number
): Promise<TornAttackResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("from", String(from));
  url.searchParams.set("limit", String(LIMIT));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn API error: ${response.status}`);
  }

  return response.json();
}


async function activateScheduledWarIfDue(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const activeWar = await env.DB.prepare(`
    SELECT id
    FROM wars
    WHERE status = 'active'
    LIMIT 1
  `).first() as { id: number } | null;

  if (activeWar) {
    return;
  }

  const scheduledWar = await env.DB.prepare(`
    SELECT id, started_at
    FROM wars
    WHERE status = 'scheduled'
      AND started_at <= ?
    ORDER BY started_at ASC
    LIMIT 1
  `).bind(now).first() as {
    id: number;
    started_at: number;
  } | null;

  if (!scheduledWar) {
    return;
  }

  await env.DB.prepare(`
    UPDATE wars
    SET status = 'active'
    WHERE id = ?
  `).bind(scheduledWar.id).run();

  await env.DB.prepare(`
    INSERT INTO sync_state (name, last_started, active_war_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      active_war_id = excluded.active_war_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(SOURCE_NAME, scheduledWar.started_at, scheduledWar.id).run();
}


async function ensureState(env: Env) {
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO NOTHING
  `
  )
    .bind(SOURCE_NAME, now)
    .run();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function boolToInt(value: boolean | undefined): number | null {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

type TornAttackResponse = {
  attacks?: TornAttack[];
};

type TornAttack = {
  id: number;
  code?: string;
  started?: number;
  ended?: number;

  attacker?: TornAttackUser | null;
  defender?: TornAttackUser | null;

  result?: string;
  respect_gain?: number;
  respect_loss?: number;

  chain?: number;
  is_interrupted?: boolean;
  is_stealthed?: boolean;
  is_raid?: boolean;
  is_ranked_war?: boolean;

  modifiers?: {
    fair_fight?: number;
    war?: number;
    retaliation?: number;
    group?: number;
    overseas?: number;
    chain?: number;
    warlord?: number;
  };

  finishing_hit_effects?: unknown[];
};

type TornAttackUser = {
  id?: number;
  name?: string;
  level?: number;
  faction?: {
    id?: number;
    name?: string;
  } | null;
};
