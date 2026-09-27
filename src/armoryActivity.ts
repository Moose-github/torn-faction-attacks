import { refreshHomeFactionMembers } from "./enemyScouting";
import type { Env } from "./types";
import { json, nowSeconds } from "./utils";

export function armoryActivityStatusQuery(env: Env) {
  return env.DB.prepare(`SELECT (SELECT last_started FROM sync_state
    WHERE name = 'home_faction_status_checked_at') AS activity_fetched_at`);
}

export async function refreshArmoryActivity(env: Env): Promise<Response> {
  const read = async () => (await armoryActivityStatusQuery(env).first<{ activity_fetched_at: number | null }>())!.activity_fetched_at;
  const fresh = (at: number | null) => at !== null && at + 300 > nowSeconds();
  let fetchedAt = await read();
  if (fresh(fetchedAt)) return json({ ok: true, activity_fetched_at: fetchedAt, status: "cached" });
  // One shared lease covers manual requests from every armory category/admin.
  // Keep it separate from the successful fetch timestamp used for data age.
  const started = nowSeconds();
  const claimed = await env.DB.prepare(`INSERT INTO sync_state (name, last_started)
    VALUES ('armory_activity_refresh_lease', ?) ON CONFLICT(name) DO UPDATE SET last_started = excluded.last_started
    WHERE sync_state.last_started <= ? RETURNING name`).bind(started, started - 120).first();
  if (!claimed) return json({ ok: true, activity_fetched_at: await read(), status: "busy" });
  try {
    fetchedAt = await read();
    if (fresh(fetchedAt)) return json({ ok: true, activity_fetched_at: fetchedAt, status: "cached" });
    const members = await refreshHomeFactionMembers(env);
    if (!members.length) throw new Error("Empty member response");
    return json({ ok: true, activity_fetched_at: await read(), status: "refreshed" });
  } catch {
    return json({ ok: false, error: "Faction activity could not be refreshed. Saved activity has been retained; please retry." }, 503);
  } finally {
    await env.DB.prepare("DELETE FROM sync_state WHERE name = 'armory_activity_refresh_lease' AND last_started = ?").bind(started).run();
  }
}
