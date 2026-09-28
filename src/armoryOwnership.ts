import type { ArmoryOwner } from "../shared/armory";
import { HOME_FACTION_ID } from "./constants";
import type { Env } from "./types";
import { json } from "./utils";

export function armoryOwnerOptionsQuery(env: Env) {
  return env.DB.prepare(`SELECT member_id AS id, name FROM home_faction_members
    WHERE faction_id = ? AND is_current = 1 ORDER BY name COLLATE NOCASE, member_id`).bind(HOME_FACTION_ID);
}

export async function updateArmoryOwner(request: Request, env: Env): Promise<Response> {
  let body: { uid?: unknown; category?: unknown; owner_id?: unknown };
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch { return json({ ok: false, error: "Enter a valid item and owner." }, 400); }
  const { uid, category, owner_id: ownerId } = body;
  if (typeof uid !== "string" || !/^[1-9]\d*$/.test(uid) || uid.length > 20
    || (category !== "weapons" && category !== "armor")
    || (ownerId !== null && (typeof ownerId !== "number" || !Number.isSafeInteger(ownerId) || ownerId <= 0))) {
    return json({ ok: false, error: "Select a weapon or armor copy and a valid owner, or Faction." }, 400);
  }
  let owner: ArmoryOwner | null = null;
  if (ownerId !== null) {
    owner = await env.DB.prepare(`SELECT member_id AS id, name FROM home_faction_members
      WHERE member_id = ? AND faction_id = ? AND is_current = 1`).bind(ownerId, HOME_FACTION_ID).first<ArmoryOwner>();
    if (!owner) return json({ ok: false, error: "Select a current faction member as the owner." }, 400);
  }
  const path = `$."${uid}"`;
  // Atomic JSON updates preserve other assignments, even during inventory sync or another admin's save.
  const result = await env.DB.prepare(`UPDATE faction_armory_state
    SET owners_json = CASE WHEN ? IS NULL THEN json_remove(owners_json, ?) ELSE json_set(owners_json, ?, json(?)) END
    WHERE faction_id = ? AND category = ? AND EXISTS (
      SELECT 1 FROM faction_armory_inventory WHERE faction_id = ? AND category = ? AND uid = ?)`)
    .bind(ownerId, path, path, JSON.stringify(owner), HOME_FACTION_ID, category, HOME_FACTION_ID, category, uid).run();
  if (!result.meta.changes) return json({ ok: false, error: "This item is no longer in the saved inventory. Refresh and try again." }, 404);
  return json({ ok: true, uid, owner });
}
