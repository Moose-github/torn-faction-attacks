import { chainWatchAlertEligible, ensureChainWatchState, readChainWatchLive, readChainWatchState, reconcileChainWatchActivity, refreshChainWatch, type ChainWatchStateRow } from "./chainWatch";
import { readJsonObject } from "./backend/request";
import { WAR_SELECT_COLUMNS } from "./sql";
import type { Env, WarRow } from "./types";
import { json, nowSeconds } from "./utils";
import { readWarFromUrl } from "./warRequest";

type WarChainWatchState = Omit<ChainWatchStateRow, "faction_id"> & { war_id: number };

// Compatibility for the War Room and existing event controls. War IDs never
// identify the live monitor or its alarm; legacy rows remain historical data.
export async function ensureChainWatchEnabledForWar(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(`INSERT INTO chain_watch_state (war_id, enabled, source, created_at, updated_at)
    VALUES (?, 1, 'stored', unixepoch(), unixepoch()) ON CONFLICT(war_id) DO NOTHING`).bind(warId).run();
  await ensureChainWatchState(env);
}

export async function setChainWatchEnabledForWar(
  env: Env, warId: number, enabled: boolean,
  options: { checkedAt?: number; refreshIfActive?: boolean } = {},
): Promise<ChainWatchStateRow | null> {
  await env.DB.prepare("UPDATE wars SET chain_watch_enabled = ? WHERE id = ?").bind(enabled ? 1 : 0, warId).run();
  const checkedAt = options.checkedAt ?? nowSeconds();
  const active = await reconcileChainWatchActivity(env, checkedAt);
  if (active && options.refreshIfActive) return refreshChainWatch(env, checkedAt);
  return readChainWatchState(env);
}

async function warChainWatchResponse(env: Env, war: WarRow) {
  const live = await readChainWatchLive(env);
  const currentWar = await env.DB.prepare("SELECT active_war_id FROM sync_state WHERE name = 'attacks' AND war_state = 'current'")
    .first<{ active_war_id: number | null }>();
  const isCurrent = currentWar?.active_war_id === war.id && war.status === "active";
  const enabled = Number(war.chain_watch_enabled ?? ((war.war_type ?? "real") === "event" ? 0 : 1));
  const state = isCurrent && live.state
    ? { ...live.state, war_id: war.id, enabled }
    : await env.DB.prepare("SELECT * FROM chain_watch_state WHERE war_id = ?").bind(war.id).first<WarChainWatchState>();
  const remaining = state?.timeout_at ? Math.max(0, state.timeout_at - live.now) : null;
  return {
    ok: true,
    war: { id: war.id, name: war.name, status: war.status, practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time, chain_watch_enabled: enabled },
    state,
    computed: { ...live.computed, active: live.computed.active && live.demand.war_id === war.id,
      alert_eligible: chainWatchAlertEligible(state?.current_chain ?? null),
      remaining_seconds: remaining, dropped: remaining !== null && remaining <= 0 },
  };
}

export async function getChainWatchForWar(url: URL, env: Env): Promise<Response> {
  try {
    const war = await readWarFromUrl(url, env);
    if (war instanceof Response) return war;
    return json(await warChainWatchResponse(env, war));
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

export async function updateChainWatchForWar(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const war = await readWarFromUrl(url, env);
    if (war instanceof Response) return war;
    const body = await readJsonObject(request);
    await setChainWatchEnabledForWar(env, war.id, Boolean(body.enabled), { refreshIfActive: true });
    const updated = await env.DB.prepare(`SELECT ${WAR_SELECT_COLUMNS} FROM wars WHERE id = ?`).bind(war.id).first<WarRow>();
    return json(await warChainWatchResponse(env, updated ?? war));
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}
