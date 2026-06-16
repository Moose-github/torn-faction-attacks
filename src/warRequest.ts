import { Env, WarRow } from "./types";
import { warNameFromWarRoute } from "./routes";
import { WAR_SELECT_COLUMNS } from "./sql";
import { json } from "./utils";

type WarFromUrlOptions = {
  select?: string;
  requireEnemyFaction?: boolean;
};

export async function readWarFromUrl<T extends object = WarRow>(
  url: URL,
  env: Env,
  options: WarFromUrlOptions = {},
): Promise<T | Response> {
  const select = options.select ?? WAR_SELECT_COLUMNS;
  const name = warNameFromWarRoute(url);

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT
      ${select}
    FROM wars
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as T | null;

  if (!war) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }

  const enemyFactionId = (war as { enemy_faction_id?: unknown }).enemy_faction_id;
  if (options.requireEnemyFaction && enemyFactionId === null) {
    return json(
      { ok: false, error: "War does not have an enemy faction ID", code: "MISSING_ENEMY_FACTION" },
      400,
    );
  }

  return war;
}

export async function readWarFromScoutingUrl(url: URL, env: Env): Promise<WarRow | Response> {
  return readWarFromUrl(url, env, { requireEnemyFaction: true });
}
