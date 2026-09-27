import type { ArmoryCategory, ArmoryInventoryCategory, ArmoryCopy, ArmoryDetails, ArmoryResponse, ArmoryMedicalResponse, ArmoryStack } from "../shared/armory";
import { HOME_FACTION_ID } from "./constants";
import { fetchTrackedTornResponse } from "./external/torn";
import { readExternalJson } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";
import { medicalStockRows, medicalStockSettings, sendMedicalStockAlert } from "./armoryStock";

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
      items.push({ uid, id, name, type, loaned, loan_first_seen_at: null, details: null });
    }
  }
  return { timestamp, items };
}

export function parseMedicalInventory(payload: unknown): { timestamp: number; items: ArmoryStack[] } {
  const data = object(payload), timestamp = integer(data.inventory_timestamp);
  if (!timestamp || !Array.isArray(data.inventory)) throw new Error("Invalid medical inventory snapshot");
  const stacks = new Map<string, ArmoryStack>();
  for (const raw of data.inventory) {
    const row = object(raw), id = integer(row.id), name = text(row.name), type = text(row.type), amount = integer(row.amount);
    if (!id || type !== "Medical" || !Array.isArray(row.uids) || row.uids.length) throw new Error("Invalid medical item");
    const borrower = row.loaned === null ? null : object(row.loaned);
    const loaned = borrower ? { id: integer(borrower.id), name: text(borrower.name) } : null;
    if (loaned && !loaned.id) throw new Error("Invalid borrower");
    // Stack identity includes the current borrower, so available and loaned stock stay separate.
    const key = `${id}:${loaned?.id ?? "available"}`;
    const existing = stacks.get(key);
    if (existing) {
      if (existing.name !== name || existing.type !== type) throw new Error("Conflicting medical item");
      existing.amount = integer(existing.amount + amount);
    } else stacks.set(key, { id, name, type, amount, loaned });
  }
  return { timestamp, items: [...stacks.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id || (a.loaned?.id ?? 0) - (b.loaned?.id ?? 0)) };
}

export function parseArmoryDetail(raw: unknown): ArmoryDetails {
  const item = object(raw), stats = object(item.stats);
  if (!Array.isArray(item.bonuses) || !(item.rarity === null || typeof item.rarity === "string")) throw new Error("Incomplete item classification");
  if (item.type !== "Weapon" && item.type !== "Armor") throw new Error("Expected weapon or armor details");
  const id = integer(item.id);
  if (!id) throw new Error("Invalid model ID");
  return {
    uid: armoryUid(item.uid), id, name: text(item.name), type: item.type,
    sub_type: item.sub_type === null ? null : text(item.sub_type),
    stats: { damage: item.type === "Weapon" ? number(stats.damage) : null,
      accuracy: item.type === "Weapon" ? number(stats.accuracy) : null,
      armor: item.type === "Armor" ? number(stats.armor) : null, quality: number(stats.quality) },
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
  source_json: string | null;
  stock_settings_json: string; stock_alert_next_at: number;
};
const OWNED = "EXISTS (SELECT 1 FROM faction_armory_state WHERE faction_id = ? AND category = ? AND lease_token = ?)";
const DETAIL_JOIN = `LEFT JOIN armory_weapon_details d ON d.uid = i.uid AND d.model_id = i.model_id AND d.payload_version = 1
  AND json_extract(d.details_json, '$.type') = CASE WHEN i.category = 'armor' THEN 'Armor' ELSE 'Weapon' END`;
const NEEDS_DETAILS = "(d.uid IS NULL OR COALESCE(f.refetch, 0) = 1)";

async function state(env: Env, category: ArmoryInventoryCategory = "weapons"): Promise<State | null> {
  return env.DB.prepare("SELECT * FROM faction_armory_state WHERE faction_id = ? AND category = ?").bind(HOME_FACTION_ID, category).first<State>();
}

function partialInventory(current: State | undefined): boolean {
  if (!current?.source_json) return false;
  try {
    const saved = JSON.parse(current.source_json);
    return !!saved._metadata?.links?.next || (typeof saved._metadata?.total === "number" && saved._metadata.total !== saved.inventory?.length);
  } catch { return true; }
}

function nextInventoryAt(timestamp: number, checkedAt: number): number {
  // A successful fetch can return an already-aged Torn snapshot. Do not restart
  // its hour; only wait a minute if Torn still returns an expired snapshot.
  const expiresAt = Math.min(timestamp, checkedAt) + HOUR;
  return expiresAt > checkedAt ? expiresAt : checkedAt + 60;
}

function inventoryDueAt(current: State | undefined): number {
  // Repair snapshots saved by the original single-page implementation without bypassing error backoff.
  if (partialInventory(current) && current?.inventory_failures === 0) return Math.max(0, current.details_blocked_until);
  if (!current || current.inventory_failures || !current.inventory_timestamp || !current.checked_at) return current?.next_inventory_at ?? 0;
  // Also shorten timers saved before snapshot-based scheduling was introduced.
  return Math.max(current.details_blocked_until,
    Math.min(current.next_inventory_at, nextInventoryAt(current.inventory_timestamp, current.checked_at)));
}

export async function readArmory(env: Env, category: ArmoryCategory = "weapons"): Promise<ArmoryResponse> {
  // A transaction keeps metadata and inventory from different refreshes from being mixed.
  const [metadata, rows] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM faction_armory_state WHERE faction_id = ? AND category = ?").bind(HOME_FACTION_ID, category),
    env.DB.prepare(`SELECT i.*, d.details_json, COALESCE(f.refetch, 0) AS refetch,
    COALESCE(f.retry_at, 0) AS retry_at FROM faction_armory_inventory i ${DETAIL_JOIN}
    LEFT JOIN armory_detail_fetch_state f ON f.uid = i.uid WHERE i.faction_id = ? AND i.category = ? ORDER BY i.name, i.uid`)
    .bind(HOME_FACTION_ID, category),
  ]);
  const current = metadata.results[0] as State | undefined;
  const records = rows.results as unknown as Array<{ uid: string; model_id: number; name: string; slot_type: string;
    borrower_id: number | null; borrower_name: string | null; loan_first_seen_at: number | null; details_json: string | null; refetch: number; retry_at: number }>;
  let pending = 0, refreshing = 0, nextDetails = Infinity;
  const items = records.map(row => {
    let details: ArmoryDetails | null = null;
    try { if (row.details_json) details = parseArmoryDetail(JSON.parse(row.details_json)); } catch { /* Defensive display for damaged cache. */ }
    if (!details) pending++;
    if (row.refetch) refreshing++;
    if (!details || row.refetch) nextDetails = Math.min(nextDetails, row.retry_at);
    return { uid: row.uid, id: row.model_id, name: row.name, type: row.slot_type,
      loan_first_seen_at: row.borrower_id === null ? null : row.loan_first_seen_at,
      loaned: row.borrower_id === null ? null : { id: row.borrower_id, name: row.borrower_name ?? String(row.borrower_id) }, details };
  });
  const nextInventory = inventoryDueAt(current);
  const nextSync = Math.max(current?.lease_until ?? 0, Math.min(nextInventory, Math.max(nextDetails, current?.details_blocked_until ?? 0)));
  return { ok: true, items, inventory_timestamp: current?.inventory_timestamp ?? null,
    checked_at: current?.checked_at ?? null, next_inventory_at: nextInventory, next_sync_at: nextSync,
    syncing: (current?.lease_until ?? 0) > now(), pending, refreshing,
    error: current?.inventory_error ?? current?.details_error ?? (partialInventory(current) ? "The saved inventory is incomplete; a full inventory refresh is queued." : null) };
}

export async function readMedicalArmory(env: Env): Promise<ArmoryMedicalResponse> {
  const current = await state(env, "medical");
  let items: ArmoryStack[] = [], error = current?.inventory_error ?? null;
  try { if (current?.source_json) items = parseMedicalInventory(JSON.parse(current.source_json)).items; }
  catch { error = "The saved medical inventory could not be read. Please refresh inventory."; }
  const settings = medicalStockSettings(current?.stock_settings_json, items);
  if (current?.inventory_timestamp) items = medicalStockRows(items, settings);
  const nextInventory = inventoryDueAt(current ?? undefined);
  return { ok: true, items, stock_settings: Object.fromEntries(Object.entries(settings).map(([id, { alerted: _alerted, ...setting }]) => [id, setting])),
    inventory_timestamp: current?.inventory_timestamp ?? null, checked_at: current?.checked_at ?? null,
    next_inventory_at: nextInventory, next_sync_at: Math.max(current?.lease_until ?? 0, nextInventory),
    syncing: (current?.lease_until ?? 0) > now(), pending: 0, refreshing: 0,
    error: error ?? (partialInventory(current ?? undefined) ? "The saved medical inventory is incomplete; a full refresh is queued." : null) };
}

export async function getArmory(env: Env, category: ArmoryInventoryCategory = "weapons"): Promise<Response> {
  const response = json(category === "medical" ? await readMedicalArmory(env) : await readArmory(env, category));
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

async function acquire(env: Env, category: ArmoryInventoryCategory = "weapons"): Promise<string | null> {
  await env.DB.prepare("INSERT OR IGNORE INTO faction_armory_state (faction_id, category) VALUES (?, ?)").bind(HOME_FACTION_ID, category).run();
  const token = crypto.randomUUID();
  const result = await env.DB.prepare("UPDATE faction_armory_state SET lease_token = ?, lease_until = ? WHERE faction_id = ? AND category = ? AND lease_until <= ?")
    .bind(token, now() + 120, HOME_FACTION_ID, category, now()).run();
  return result.meta.changes ? token : null;
}

async function release(env: Env, token: string, category: ArmoryInventoryCategory): Promise<void> {
  await env.DB.prepare("UPDATE faction_armory_state SET lease_token = NULL, lease_until = 0 WHERE faction_id = ? AND category = ? AND lease_token = ?")
    .bind(HOME_FACTION_ID, category, token).run();
}

async function renewLease(env: Env, token: string, category: ArmoryInventoryCategory): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE faction_armory_state SET lease_until = ? WHERE faction_id = ? AND category = ? AND lease_token = ?")
    .bind(now() + 120, HOME_FACTION_ID, category, token).run();
  return !!result.meta.changes;
}

async function fetchCompleteInventory(env: Env, token: string, category: ArmoryInventoryCategory): Promise<unknown> {
  let path: string | null = `faction/inventory?cat=${category}&limit=100&offset=0`;
  let timestamp: number | null = null, total: number | null = null;
  const inventory: unknown[] = [];
  while (path !== null) {
    if (!await renewLease(env, token, category)) throw new Error("Inventory sync lease was replaced");
    const page = object(await fetchArmoryData(env, path, "armory_inventory"));
    const parsed = category === "medical" ? parseMedicalInventory(page) : parseArmoryInventory(page);
    if (timestamp !== null && timestamp !== parsed.timestamp) throw new Error("Inventory snapshot changed between pages");
    timestamp = parsed.timestamp;
    const rows = page.inventory as unknown[];
    inventory.push(...rows);
    if (page._metadata === undefined) {
      if (total !== null) throw new Error("Missing inventory pagination metadata");
      path = null;
      continue;
    }
    const metadata = object(page._metadata), links = object(metadata.links);
    const pageTotal = integer(metadata.total);
    if (total !== null && total !== pageTotal) throw new Error("Inventory total changed between pages");
    total = pageTotal;
    if (inventory.length > total) throw new Error("Inventory exceeds pagination total");
    // Torn can emit a next link even for its final (or empty) page. The reported
    // row total is the completion condition; following those links can continue forever.
    if (inventory.length === total) {
      path = null;
      continue;
    }
    if (links.next === null) {
      if (inventory.length !== total) throw new Error("Incomplete inventory pagination");
      path = null;
      continue;
    }
    if (!rows.length) throw new Error("Inventory pagination made no progress");
    const next = new URL(text(links.next), "https://api.torn.com");
    // Never forward the server key to arbitrary URLs or follow a loop/skipped page.
    if (next.origin !== "https://api.torn.com" || next.pathname !== "/v2/faction/inventory" || next.username || next.password || next.hash || next.searchParams.get("cat") !== category) {
      throw new Error("Invalid inventory next-page URL");
    }
    const offset = Number(next.searchParams.get("offset")), limit = Number(next.searchParams.get("limit"));
    if (!Number.isSafeInteger(offset) || offset !== inventory.length || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error("Invalid inventory pagination offset or limit");
    }
    path = `faction/inventory?cat=${category}&limit=${limit}&offset=${offset}`;
  }
  // Validate the aggregate as well, catching duplicate UIDs across pages before any replacement.
  const complete = { inventory_timestamp: timestamp, inventory,
    _metadata: { total: total ?? inventory.length, links: { prev: null, next: null } } };
  if (category === "medical") parseMedicalInventory(complete);
  else parseArmoryInventory(complete);
  return complete;
}

async function saveInventory(env: Env, token: string, payload: unknown, previous: State, category: ArmoryInventoryCategory): Promise<void> {
  const inventory = category === "medical" ? parseMedicalInventory(payload) : parseArmoryInventory(payload);
  if (previous.inventory_timestamp !== null && inventory.timestamp < previous.inventory_timestamp) throw new Error("Older snapshot");
  const checkedAt = now(), nextInventory = nextInventoryAt(inventory.timestamp, checkedAt);
  if (category === "medical") {
    // Persist only the latest quantity/borrower snapshot; no UIDs, detail calls or loan timestamps.
    let priorItems: ArmoryStack[] = [];
    try { if (previous.source_json) priorItems = parseMedicalInventory(JSON.parse(previous.source_json)).items; }
    catch { /* A damaged old cache must not prevent a valid replacement. */ }
    const settings = medicalStockSettings(previous.stock_settings_json, [...priorItems, ...inventory.items as ArmoryStack[]]);
    const unchangedSnapshot = previous.inventory_timestamp === inventory.timestamp
      && JSON.stringify(priorItems) === JSON.stringify(inventory.items);
    await env.DB.prepare(`UPDATE faction_armory_state SET inventory_timestamp = ?, checked_at = ?, next_inventory_at = ?,
      inventory_failures = 0, inventory_error = NULL, stock_alert_next_at = ?, stock_settings_json = ?, source_json = ?
      WHERE faction_id = ? AND category = ? AND lease_token = ?`)
      .bind(inventory.timestamp, checkedAt, nextInventory, unchangedSnapshot ? previous.stock_alert_next_at : 0,
        JSON.stringify(settings), JSON.stringify(payload), HOME_FACTION_ID, category, token).run();
    return;
  }
  const copyJson = JSON.stringify(inventory.items);
  const conflict = await env.DB.prepare(`SELECT d.uid FROM armory_weapon_details d JOIN json_each(?) j
    ON d.uid = json_extract(j.value, '$.uid') WHERE d.model_id != json_extract(j.value, '$.id') LIMIT 1`)
    .bind(copyJson).first();
  if (conflict) throw new Error("An inventory UID changed model ID");
  const otherCategory = await env.DB.prepare(`SELECT i.uid FROM faction_armory_inventory i JOIN json_each(?) j
    ON i.uid = json_extract(j.value, '$.uid') WHERE i.faction_id = ? AND i.category != ? LIMIT 1`)
    .bind(copyJson, HOME_FACTION_ID, category).first();
  if (otherCategory) throw new Error("An inventory UID changed category");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO faction_armory_inventory (faction_id, category, uid, model_id, name, slot_type, borrower_id, borrower_name, loan_first_seen_at)
      SELECT ?, ?, json_extract(value, '$.uid'), json_extract(value, '$.id'), json_extract(value, '$.name'),
      json_extract(value, '$.type'), json_extract(value, '$.loaned.id'), json_extract(value, '$.loaned.name'),
      CASE WHEN json_extract(value, '$.loaned.id') IS NOT NULL THEN ? ELSE NULL END
      FROM json_each(?) WHERE ${OWNED}
      ON CONFLICT(faction_id, uid) DO UPDATE SET
        loan_first_seen_at = CASE
          WHEN excluded.borrower_id IS NULL THEN NULL
          WHEN faction_armory_inventory.borrower_id = excluded.borrower_id
            AND faction_armory_inventory.model_id = excluded.model_id
            AND faction_armory_inventory.category = excluded.category
            THEN COALESCE(faction_armory_inventory.loan_first_seen_at, excluded.loan_first_seen_at)
          ELSE excluded.loan_first_seen_at END,
        category = excluded.category, model_id = excluded.model_id, name = excluded.name, slot_type = excluded.slot_type,
        borrower_id = excluded.borrower_id, borrower_name = excluded.borrower_name`)
      .bind(HOME_FACTION_ID, category, now(), copyJson, HOME_FACTION_ID, category, token),
    env.DB.prepare(`DELETE FROM faction_armory_inventory WHERE faction_id = ? AND category = ? AND ${OWNED}
      AND uid NOT IN (SELECT json_extract(value, '$.uid') FROM json_each(?))`)
      .bind(HOME_FACTION_ID, category, HOME_FACTION_ID, category, token, copyJson),
    env.DB.prepare(`UPDATE faction_armory_state SET inventory_timestamp = ?, checked_at = ?, next_inventory_at = ?,
      inventory_failures = 0, inventory_error = NULL, source_json = ? WHERE faction_id = ? AND category = ? AND lease_token = ?`)
      .bind(inventory.timestamp, checkedAt, nextInventory, JSON.stringify(payload), HOME_FACTION_ID, category, token),
  ]);
}

export async function syncArmory(env: Env, category: ArmoryInventoryCategory = "weapons"): Promise<Response> {
  const token = await acquire(env, category);
  if (!token) return getArmory(env, category);
  try {
    const current = (await state(env, category))!;
    if (inventoryDueAt(current) <= now()) {
      try {
        await saveInventory(env, token, await fetchCompleteInventory(env, token, category), current, category);
      } catch (error) {
        const fail = failure(error, current.inventory_failures);
        await env.DB.prepare(`UPDATE faction_armory_state SET inventory_error = ?, inventory_failures = inventory_failures + 1,
          next_inventory_at = ?, details_blocked_until = MAX(details_blocked_until, ?) WHERE faction_id = ? AND category = ? AND lease_token = ?`)
          .bind(fail.message, now() + fail.delay, fail.halt ? now() + fail.delay : 0, HOME_FACTION_ID, category, token).run();
        if (fail.halt) return await finishArmory(env, token, category);
      }
    }
    if (category === "medical") {
      await checkMedicalStockAlerts(env, token);
      return await finishArmory(env, token, category);
    }
    if (((await state(env, category))?.details_blocked_until ?? 0) > now()) return await finishArmory(env, token, category);
    // Renew between bounded network requests, including after a multi-page inventory fetch.
    for (let batch = 0; batch < 4; batch++) {
      if (!await renewLease(env, token, category)) break;
      const requested = await env.DB.prepare(`SELECT i.uid, i.model_id, COALESCE(f.attempts, 0) AS attempts
        FROM faction_armory_inventory i ${DETAIL_JOIN} LEFT JOIN armory_detail_fetch_state f ON f.uid = i.uid
        WHERE i.faction_id = ? AND i.category = ? AND ${NEEDS_DETAILS} AND COALESCE(f.retry_at, 0) <= ? AND ${OWNED}
        ORDER BY i.uid LIMIT 25`).bind(HOME_FACTION_ID, category, now(), HOME_FACTION_ID, category, token)
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
        if (detail && detail.id === row.model_id && detail.type === (category === "armor" ? "Armor" : "Weapon")) {
          statements.push(env.DB.prepare(`INSERT INTO armory_weapon_details (uid, model_id, details_json, fetched_at, payload_version)
            SELECT ?, ?, ?, ?, 1 WHERE ${OWNED} ON CONFLICT(uid) DO UPDATE SET model_id = excluded.model_id,
            details_json = excluded.details_json, fetched_at = excluded.fetched_at, payload_version = 1`)
            .bind(row.uid, row.model_id, JSON.stringify(detail), now(), HOME_FACTION_ID, category, token));
          statements.push(env.DB.prepare(`DELETE FROM armory_detail_fetch_state WHERE uid = ? AND ${OWNED}`).bind(row.uid, HOME_FACTION_ID, category, token));
        } else {
          failed = true;
          const fail = failure(batchError, row.attempts);
          statements.push(env.DB.prepare(`INSERT INTO armory_detail_fetch_state (uid, attempts, retry_at, error)
            SELECT ?, ?, ?, ? WHERE ${OWNED} ON CONFLICT(uid) DO UPDATE SET attempts = excluded.attempts,
            retry_at = excluded.retry_at, error = excluded.error`)
            .bind(row.uid, row.attempts + 1, now() + fail.delay, batchError ? fail.message : "Item details missing or invalid; retry scheduled.", HOME_FACTION_ID, category, token));
        }
      }
      const halt = batchError instanceof ArmoryUpstreamError && batchError.halt;
      const blockedUntil = halt ? now() + (batchError as ArmoryUpstreamError).delay : 0;
      statements.push(env.DB.prepare(`UPDATE faction_armory_state SET details_error = ?, details_blocked_until = ?,
        next_inventory_at = MAX(next_inventory_at, ?) WHERE faction_id = ? AND category = ? AND lease_token = ?`)
        .bind(failed ? failure(batchError, 0).message : null, blockedUntil, blockedUntil, HOME_FACTION_ID, category, token));
      await env.DB.batch(statements);
      if (halt) break;
    }
  } finally { await release(env, token, category); }
  return getArmory(env, category);
}

// Release before returning a snapshot so clients never wait out their own completed lease.
async function finishArmory(env: Env, token: string, category: ArmoryInventoryCategory): Promise<Response> {
  await release(env, token, category);
  return getArmory(env, category);
}

export async function refreshArmoryDetails(env: Env, category: ArmoryCategory = "weapons"): Promise<Response> {
  const token = await acquire(env, category);
  if (!token) return getArmory(env, category);
  try {
    const current = (await state(env, category))!;
    const active = await env.DB.prepare(`SELECT COUNT(*) AS count FROM armory_detail_fetch_state f
      JOIN faction_armory_inventory i ON i.uid = f.uid WHERE i.faction_id = ? AND i.category = ? AND f.refetch = 1`).bind(HOME_FACTION_ID, category).first<{ count: number }>();
    if (!active?.count && current.details_refresh_at + HOUR <= now()) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO armory_detail_fetch_state (uid, refetch)
          SELECT uid, 1 FROM faction_armory_inventory WHERE faction_id = ? AND category = ? AND ${OWNED}
          ON CONFLICT(uid) DO UPDATE SET refetch = 1`)
          .bind(HOME_FACTION_ID, category, HOME_FACTION_ID, category, token),
        env.DB.prepare("UPDATE faction_armory_state SET details_refresh_at = ? WHERE faction_id = ? AND category = ? AND lease_token = ?")
          .bind(now(), HOME_FACTION_ID, category, token),
      ]);
    }
  } finally { await release(env, token, category); }
  return getArmory(env, category);
}

// Cron checks every minute; inventory becomes due one hour after Torn's snapshot.
// Both page refreshes and cron use the same category lease, cache and error backoff.
export async function runMedicalArmoryCron(env: Env): Promise<void> {
  const current = await state(env, "medical");
  if ((current?.lease_until ?? 0) > now()) return;
  const inventoryDue = inventoryDueAt(current ?? undefined) <= now();
  const alertsDue = current?.source_json && !current.inventory_error && current.stock_alert_next_at <= now();
  if (inventoryDue || alertsDue) await syncArmory(env, "medical");
}

async function checkMedicalStockAlerts(env: Env, token: string): Promise<void> {
  const current = (await state(env, "medical"))!;
  // Do not infer low stock or recovery from failed, incomplete or stale inventory.
  if (!current.source_json || current.inventory_error || partialInventory(current)
    || !current.checked_at || current.checked_at + HOUR < now() || current.stock_alert_next_at > now()) return;
  const items = parseMedicalInventory(JSON.parse(current.source_json)).items;
  const settings = medicalStockSettings(current.stock_settings_json, items);
  const quantities = new Map(items.filter(item => !item.loaned).map(item => [item.id, item.amount]));
  let retry = false;
  const persist = () => env.DB.prepare(`UPDATE faction_armory_state SET stock_settings_json = ?, stock_alert_next_at = ?
    WHERE faction_id = ? AND category = 'medical' AND lease_token = ?`)
    .bind(JSON.stringify(settings), now() + (retry ? 300 : HOUR), HOME_FACTION_ID, token).run();
  // Persist newly seen models before sending, retaining them if a later snapshot omits them.
  await persist();
  for (const [id, setting] of Object.entries(settings)) {
    const amount = quantities.get(Number(id)) ?? 0;
    if (!setting.enabled || amount > setting.threshold) {
      setting.alerted = false;
      continue;
    }
    if (setting.alerted) continue;
    if (!await renewLease(env, token, "medical")) return;
    try {
      setting.alerted = await sendMedicalStockAlert(env, setting.name, amount, setting.threshold);
    } catch (error) {
      console.error(`Medical stock alert failed for item ${id}:`, error instanceof Error ? error.message : error);
    }
    if (!setting.alerted) retry = true;
    // Save delivery immediately so another failed alert does not repeat successful messages.
    await persist();
  }
  await persist();
}

export async function updateMedicalStockSetting(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = object(await request.json()); }
  catch { return json({ ok: false, error: "Enter a valid item and stock threshold." }, 400); }
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id) || body.id <= 0
    || typeof body.threshold !== "number" || !Number.isSafeInteger(body.threshold) || body.threshold < 0
    || typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "Threshold must be a whole number of 0 or more, with an enabled toggle." }, 400);
  }
  const token = await acquire(env, "medical");
  if (!token) return json({ ok: false, error: "Inventory is being refreshed. Please save again in a moment." }, 409);
  try {
    const current = (await state(env, "medical"))!;
    const items = current.source_json ? parseMedicalInventory(JSON.parse(current.source_json)).items : [];
    const settings = medicalStockSettings(current.stock_settings_json, items), setting = settings[body.id];
    if (!setting) return json({ ok: false, error: "Unknown medical item." }, 404);
    if (setting.threshold !== body.threshold || setting.enabled !== body.enabled) {
      // A changed rule starts a fresh evaluation, including when enabled while already low.
      setting.threshold = body.threshold; setting.enabled = body.enabled; setting.alerted = false;
    }
    await env.DB.prepare(`UPDATE faction_armory_state SET stock_settings_json = ?, stock_alert_next_at = 0
      WHERE faction_id = ? AND category = 'medical' AND lease_token = ?`)
      .bind(JSON.stringify(settings), HOME_FACTION_ID, token).run();
  } finally { await release(env, token, "medical"); }
  return getArmory(env, "medical");
}
