import { Env, WarRow } from "./types";
import { warNameFromWarRoute } from "./routes";
import { json } from "./utils";

export async function readWarFromScoutingUrl(url: URL, env: Env): Promise<WarRow | Response> {
  const name = warNameFromWarRoute(url);

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT *
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

  if (war.enemy_faction_id === null) {
    return json(
      { ok: false, error: "War does not have an enemy faction ID", code: "MISSING_ENEMY_FACTION" },
      400,
    );
  }

  return war;
}
