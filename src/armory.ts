import type { ArmoryCopy, ArmoryDetails, ArmoryResponse } from "../shared/armory";
import { HOME_FACTION_ID } from "./constants";
import { fetchTrackedTornResponse } from "./external/torn";
import { readExternalJson } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid text");
  return value;
};
const number = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid number");
  return value;
};
const integer = (value: unknown): number => {
  const result = number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid integer");
  return result;
};
export function armoryUid(value: unknown): string {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  const uid = integer(value);
  if (!uid) throw new Error("Invalid UID");
  return String(uid);
}

export function parseArmoryInventory(payload: unknown): { timestamp: number; items: ArmoryCopy[] } {
  const data = object(payload);
  const timestamp = integer(data.inventory_timestamp);
  if (!timestamp || !Array.isArray(data.inventory)) throw new Error("Invalid inventory snapshot");
  const seen = new Set<string>();
  const items: ArmoryCopy[] = [];
  for (const raw of data.inventory) {
    const row = object(raw);
    const id = integer(row.id), name = text(row.name), type = text(row.type);
    if (!id || !Array.isArray(row.uids) || integer(row.amount) !== row.uids.length) throw new Error("Inventory counts do not match UIDs");
    const borrower = row.loaned === null ? null : object(row.loaned);
    const loaned = borrower ? { id: integer(borrower.id), name: text(borrower.name) } : null;
    if (loaned && !loaned.id) throw new Error("Invalid borrower");
    for (const rawUid of row.uids) {
      const uid = armoryUid(rawUid);
      if (seen.has(uid)) throw new Error("Duplicate inventory UID");
      seen.add(uid);
      items.push({ uid, id, name, type, loaned, details: null });
    }
  }
  return { timestamp, items };
}

export function parseArmoryDetail(raw: unknown): ArmoryDetails {
  const item = object(raw), stats = object(item.stats);
  if (!Array.isArray(item.bonuses) || !(item.rarity === null || typeof item.rarity === "string")) throw new Error("Incomplete weapon classification");
  if (item.type !== "Weapon") throw new Error("Expected weapon details");
  const id = integer(item.id);
  if (!id) throw new Error("Invalid model ID");
  return {
    uid: armoryUid(item.uid), id, name: text(item.name), type: "Weapon",
    sub_type: item.sub_type === null ? null : text(item.sub_type),
    stats: { damage: number(stats.damage), accuracy: number(stats.accuracy), quality: number(stats.quality) },
    rarity: item.rarity === null ? null : text(item.rarity),
    bonuses: item.bonuses.map(rawBonus => {
      const bonus = object(rawBonus);
      return { id: integer(bonus.id), title: text(bonus.title), description: text(bonus.description), value: number(bonus.value) };
    }),
  };
}

export function parseArmoryDetails(payload: unknown): Map<string, ArmoryDetails> {
  const data = object(payload).itemdetails;
  const rows = Array.isArray(data) ? data : [data];
  const result = new Map<string, ArmoryDetails>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    try {
      const detail = parseArmoryDetail(row);
      if (result.has(detail.uid)) duplicates.add(detail.uid);
      result.set(detail.uid, detail);
    } catch { /* Invalid or missing records remain pending; valid siblings still cache. */ }
  }
  for (const uid of duplicates) result.delete(uid);
  return result;
}

type State = {
  inventory_timestamp: number | null; checked_at: number | null; next_inventory_at: number;
  inventory_failures: number; inventory_error: string | null; details_blocked_until: number;
  details_error: string | null; lease_until: number; details_refresh_at: number;
};
const OWNED = "EXISTS (SELECT 1 FROM faction_armory_state WHERE faction_id = ? AND lease_token = ?)";
const DETAIL_JOIN = "LEFT JOIN armory_weapon_details d ON d.uid = i.uid AND d.model_id = i.model_id AND d.payload_version = 1";
const NEEDS_DETAILS = "(d.uid IS NULL OR COALESCE(f.refetch, 0) = 1)";

async function state(env: Env): Promise<State | null> {
  return env.DB.prepare("SELECT * FROM faction_armory_state WHERE faction_id = ?").bind(HOME_FACTION_ID).first<State>();
}

export async function readArmory(env: Env): Promise<ArmoryResponse> {
  // A transaction keeps metadata and inventory from different refreshes from being mixed.
  const [metadata, rows] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM faction_armory_state WHERE faction_id = ?").bind(HOME_FACTION_ID),
    env.DB.prepare(`SELECT i.*, d.details_json, COALESCE(f.refetch, 0) AS refetch,
    COALESCE(f.retry_at, 0) AS retry_at FROM faction_armory_inventory i ${DETAIL_JOIN}
    LEFT JOIN armory_detail_fetch_state f ON f.uid = i.uid WHERE i.faction_id = ? ORDER BY i.name, i.uid`)
    .bind(HOME_FACTION_ID),
  ]);
  const current = metadata.results[0] as State | undefined;
  const records = rows.results as unknown as Array<{ uid: string; model_id: number; name: string; slot_type: string;
    borrower_id: number | null; borrower_name: string | null; details_json: string | null; refetch: number; retry_at: number }>;
  let pending = 0, refreshing = 0, nextDetails = Infinity;
  const items = records.map(row => {
    let details: ArmoryDetails | null = null;
    try { if (row.details_json) details = parseArmoryDetail(JSON.parse(row.details_json)); } catch { /* Defensive display for damaged cache. */ }
    if (!details) pending++;
    if (row.refetch) refreshing++;
    if (!details || row.refetch) nextDetails = Math.min(nextDetails, row.retry_at);
    return { uid: row.uid, id: row.model_id, name: row.name, type: row.slot_type,
      loaned: row.borrower_id === null ? null : { id: row.borrower_id, name: row.borrower_name ?? String(row.borrower_id) }, details };
  });
  const nextInventory = current?.next_inventory_at ?? 0;
  const nextSync = Math.max(current?.lease_until ?? 0, Math.min(nextInventory, Math.max(nextDetails, current?.details_blocked_until ?? 0)));
  return { ok: true, items, inventory_timestamp: current?.inventory_timestamp ?? null,
    checked_at: current?.checked_at ?? null, next_inventory_at: nextInventory, next_sync_at: nextSync,
    syncing: (current?.lease_until ?? 0) > now(), pending, refreshing,
    error: current?.inventory_error ?? current?.details_error ?? null };
}

export async function getArmory(env: Env): Promise<Response> {
  const response = json(await readArmory(env));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

class ArmoryUpstreamError extends Error {
  constructor(message: string, readonly delay: number = 60, readonly halt = false) { super(message); }
}

async function fetchArmoryData(env: Env, path: string, feature: string): Promise<unknown> {
  const key = (typeof env.TORN_API_KEY === "string" ? env.TORN_API_KEY : await env.TORN_API_KEY?.get())?.trim();
  if (!key) throw new ArmoryUpstreamError("Configure the server Torn API key with faction inventory access.", HOUR, true);
  const response = await fetchTrackedTornResponse(env, `https://api.torn.com/v2/${path}`, {
    headers: { Accept: "application/json", Authorization: `ApiKey ${key}` },
  }, { feature, keySource: "env:TORN_API_KEY", timeoutMs: 15_000 });
  const raw = await readExternalJson<Record<string, unknown>>(response);
  const error = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : null;
  const code = Number(error?.code);
  if ([1, 2, 7, 10, 12, 13, 16, 18].includes(code) || response.status === 401 || response.status === 403) {
    throw new ArmoryUpstreamError("The server Torn key cannot access armory data. Check its access level and faction permissions.", HOUR, true);
  }
  if (response.status === 429 || code === 5) {
    const header = response.headers.get("Retry-After");
    const seconds = header && /^\d+$/.test(header) ? Number(header) : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 60;
    throw new ArmoryUpstreamError("Torn rate limit reached; armory sync will retry later.", Math.max(60, Number.isFinite(seconds) ? seconds : 60), true);
  }
  if (!response.ok || raw.error) throw new ArmoryUpstreamError("Torn could not return armory data; the previous data is retained.");
  return raw;
}

function failure(error: unknown, attempts: number): { message: string; delay: number; halt: boolean } {
  return { message: error instanceof ArmoryUpstreamError ? error.message : "Armory data could not be validated or fetched; previous data is retained.",
    delay: Math.max(Math.min(HOUR, 60 * 2 ** Math.min(attempts, 6)), error instanceof ArmoryUpstreamError ? error.delay : 0),
    halt: error instanceof ArmoryUpstreamError && error.halt };
}

async function acquire(env: Env): Promise<string | null> {
  await env.DB.prepare("INSERT OR IGNORE INTO faction_armory_state (faction_id) VALUES (?)").bind(HOME_FACTION_ID).run();
  const token = crypto.randomUUID();
  const result = await env.DB.prepare("UPDATE faction_armory_state SET lease_token = ?, lease_until = ? WHERE faction_id = ? AND lease_until <= ?")
    .bind(token, now() + 120, HOME_FACTION_ID, now()).run();
  return result.meta.changes ? token : null;
}

async function release(env: Env, token: string): Promise<void> {
  await env.DB.prepare("UPDATE faction_armory_state SET lease_token = NULL, lease_until = 0 WHERE faction_id = ? AND lease_token = ?")
    .bind(HOME_FACTION_ID, token).run();
}

async function saveInventory(env: Env, token: string, payload: unknown, previous: State): Promise<void> {
  const inventory = parseArmoryInventory(payload);
  if (previous.inventory_timestamp !== null && inventory.timestamp < previous.inventory_timestamp) throw new Error("Older snapshot");
  const copyJson = JSON.stringify(inventory.items);
  const conflict = await env.DB.prepare(`SELECT d.uid FROM armory_weapon_details d JOIN json_each(?) j
    ON d.uid = json_extract(j.value, '$.uid') WHERE d.model_id != json_extract(j.value, '$.id') LIMIT 1`)
    .bind(copyJson).first();
  if (conflict) throw new Error("An inventory UID changed model ID");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM faction_armory_inventory WHERE faction_id = ? AND ${OWNED}`).bind(HOME_FACTION_ID, HOME_FACTION_ID, token),
    env.DB.prepare(`INSERT INTO faction_armory_inventory (faction_id, uid, model_id, name, slot_type, borrower_id, borrower_name)
      SELECT ?, json_extract(value, '$.uid'), json_extract(value, '$.id'), json_extract(value, '$.name'),
      json_extract(value, '$.type'), json_extract(value, '$.loaned.id'), json_extract(value, '$.loaned.name')
      FROM json_each(?) WHERE ${OWNED}`).bind(HOME_FACTION_ID, copyJson, HOME_FACTION_ID, token),
    env.DB.prepare(`UPDATE faction_armory_state SET inventory_timestamp = ?, checked_at = ?, next_inventory_at = ?,
      inventory_failures = 0, inventory_error = NULL, source_json = ? WHERE faction_id = ? AND lease_token = ?`)
      .bind(inventory.timestamp, now(), now() + HOUR, JSON.stringify(payload), HOME_FACTION_ID, token),
  ]);
}

export async function syncArmory(env: Env): Promise<Response> {
  const token = await acquire(env);
  if (!token) return getArmory(env);
  try {
    const current = (await state(env))!;
    if (current.next_inventory_at <= now()) {
      try {
        await saveInventory(env, token, await fetchArmoryData(env, "faction/inventory?cat=weapons", "armory_inventory"), current);
      } catch (error) {
        const fail = failure(error, current.inventory_failures);
        await env.DB.prepare(`UPDATE faction_armory_state SET inventory_error = ?, inventory_failures = inventory_failures + 1,
          next_inventory_at = ?, details_blocked_until = MAX(details_blocked_until, ?) WHERE faction_id = ? AND lease_token = ?`)
          .bind(fail.message, now() + fail.delay, fail.halt ? now() + fail.delay : 0, HOME_FACTION_ID, token).run();
        if (fail.halt) return await finishArmory(env, token);
      }
    }
    if (((await state(env))?.details_blocked_until ?? 0) > now()) return await finishArmory(env, token);
    // Serial batches stay under the lease and upstream timeout budget (5 x 15s maximum).
    for (let batch = 0; batch < 4; batch++) {
      const requested = await env.DB.prepare(`SELECT i.uid, i.model_id, COALESCE(f.attempts, 0) AS attempts
        FROM faction_armory_inventory i ${DETAIL_JOIN} LEFT JOIN armory_detail_fetch_state f ON f.uid = i.uid
        WHERE i.faction_id = ? AND ${NEEDS_DETAILS} AND COALESCE(f.retry_at, 0) <= ? AND ${OWNED}
        ORDER BY i.uid LIMIT 25`).bind(HOME_FACTION_ID, now(), HOME_FACTION_ID, token)
        .all<{ uid: string; model_id: number; attempts: number }>();
      if (!requested.results.length) break;
      let details = new Map<string, ArmoryDetails>(), batchError: unknown = null;
      try {
        details = parseArmoryDetails(await fetchArmoryData(env, `torn/${requested.results.map(row => row.uid).join(",")}/itemdetails`, "armory_details"));
      } catch (error) { batchError = error; }
      const statements: D1PreparedStatement[] = [];
      let failed = false;
      for (const row of requested.results) {
        const detail = details.get(row.uid);
        if (detail && detail.id === row.model_id) {
          statements.push(env.DB.prepare(`INSERT INTO armory_weapon_details (uid, model_id, details_json, fetched_at, payload_version)
            SELECT ?, ?, ?, ?, 1 WHERE ${OWNED} ON CONFLICT(uid) DO UPDATE SET model_id = excluded.model_id,
            details_json = excluded.details_json, fetched_at = excluded.fetched_at, payload_version = 1`)
            .bind(row.uid, row.model_id, JSON.stringify(detail), now(), HOME_FACTION_ID, token));
          statements.push(env.DB.prepare(`DELETE FROM armory_detail_fetch_state WHERE uid = ? AND ${OWNED}`).bind(row.uid, HOME_FACTION_ID, token));
        } else {
          failed = true;
          const fail = failure(batchError, row.attempts);
          statements.push(env.DB.prepare(`INSERT INTO armory_detail_fetch_state (uid, attempts, retry_at, error)
            SELECT ?, ?, ?, ? WHERE ${OWNED} ON CONFLICT(uid) DO UPDATE SET attempts = excluded.attempts,
            retry_at = excluded.retry_at, error = excluded.error`)
            .bind(row.uid, row.attempts + 1, now() + fail.delay, batchError ? fail.message : "Weapon details missing or invalid; retry scheduled.", HOME_FACTION_ID, token));
        }
      }
      const halt = batchError instanceof ArmoryUpstreamError && batchError.halt;
      const blockedUntil = halt ? now() + (batchError as ArmoryUpstreamError).delay : 0;
      statements.push(env.DB.prepare(`UPDATE faction_armory_state SET details_error = ?, details_blocked_until = ?,
        next_inventory_at = MAX(next_inventory_at, ?) WHERE faction_id = ? AND lease_token = ?`)
        .bind(failed ? failure(batchError, 0).message : null, blockedUntil, blockedUntil, HOME_FACTION_ID, token));
      await env.DB.batch(statements);
      if (halt) break;
    }
  } finally { await release(env, token); }
  return getArmory(env);
}

// Release before returning a snapshot so clients never wait out their own completed lease.
async function finishArmory(env: Env, token: string): Promise<Response> {
  await release(env, token);
  return getArmory(env);
}

export async function refreshArmoryDetails(env: Env): Promise<Response> {
  const token = await acquire(env);
  if (!token) return getArmory(env);
  try {
    const current = (await state(env))!;
    const active = await env.DB.prepare(`SELECT COUNT(*) AS count FROM armory_detail_fetch_state f
      JOIN faction_armory_inventory i ON i.uid = f.uid WHERE i.faction_id = ? AND f.refetch = 1`).bind(HOME_FACTION_ID).first<{ count: number }>();
    if (!active?.count && current.details_refresh_at + HOUR <= now()) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO armory_detail_fetch_state (uid, refetch)
          SELECT uid, 1 FROM faction_armory_inventory WHERE faction_id = ? AND ${OWNED}
          ON CONFLICT(uid) DO UPDATE SET refetch = 1`)
          .bind(HOME_FACTION_ID, HOME_FACTION_ID, token),
        env.DB.prepare("UPDATE faction_armory_state SET details_refresh_at = ? WHERE faction_id = ? AND lease_token = ?")
          .bind(now(), HOME_FACTION_ID, token),
      ]);
    }
  } finally { await release(env, token); }
  return getArmory(env);
}
