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

      const rows = await env.DB.prepare(`
        SELECT *
        FROM attacks
        ORDER BY started DESC
        LIMIT ?
      `).bind(limit).all();

      return json(rows.results ?? []);
    }

    if (url.pathname === "/api/stats") {
      const stats = await env.DB.prepare(`
        SELECT
          COUNT(*) AS total_attacks,
          COALESCE(SUM(respect_gain), 0) AS total_respect_gain,
          COALESCE(SUM(respect_loss), 0) AS total_respect_loss,
          MAX(started) AS latest_attack_started
        FROM attacks
      `).first();

      return json(stats);
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(
    event: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runIngestion(env));
  },
};

async function runIngestion(env: Env) {
  await ensureState(env);

  const state = await env.DB.prepare(`
    SELECT last_started
    FROM sync_state
    WHERE name = ?
`).bind(SOURCE_NAME).first() as { last_started: number } | null;

  let from = Math.max(0, (state?.last_started ?? 0) - OVERLAP_SECONDS);
  let newestStarted = state?.last_started ?? 0;

  while (true) {
    const data = await fetchAttacks(env, from);
    const attacks = data.attacks ?? [];

    if (attacks.length === 0) {
      break;
    }

    const statements: D1PreparedStatement[] = [];

    for (const attack of attacks) {
      newestStarted = Math.max(newestStarted, attack.started ?? 0);

      statements.push(
        env.DB.prepare(`
          INSERT INTO attacks (
            id,
            code,
            started,
            ended,
            attacker_id,
            attacker_faction_id,
            defender_id,
            defender_faction_id,
            result,
            respect_gain,
            respect_loss,
            fetched_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            code = excluded.code,
            started = excluded.started,
            ended = excluded.ended,
            attacker_id = excluded.attacker_id,
            attacker_faction_id = excluded.attacker_faction_id,
            defender_id = excluded.defender_id,
            defender_faction_id = excluded.defender_faction_id,
            result = excluded.result,
            respect_gain = excluded.respect_gain,
            respect_loss = excluded.respect_loss,
            fetched_at = CURRENT_TIMESTAMP
        `).bind(
            attack.id,
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
            boolToInt(attack.is_ranked_war)
          )
      );
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    await env.DB.prepare(`
      INSERT INTO sync_state (name, last_started, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        last_started = excluded.last_started,
        updated_at = CURRENT_TIMESTAMP
    `).bind(SOURCE_NAME, newestStarted).run();

    if (attacks.length < LIMIT) {
      break;
    }

    from = newestStarted;
  }
}

async function fetchAttacks(env: Env, from: number): Promise<TornAttackResponse> {
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

async function ensureState(env: Env) {
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(`
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO NOTHING
  `).bind(SOURCE_NAME, now).run();
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
