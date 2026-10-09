import type { ChainWatchStateRow } from "./chainWatch";
import { deleteWatchDiscordMessage, editWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { HOME_FACTION_ID, POSITIVE_RESULTS_SQL } from "./constants";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

type WarningCycle = {
  faction_id: number;
  reset_at: number;
  timeout_at: number;
  chain_length: number;
  warning_message_id: string | null;
  warning_channel_id: string | null;
  critical_message_id: string | null;
  critical_channel_id: string | null;
  outcome_text: string | null;
  edited_message_id: string | null;
  warning_deleted_at: number | null;
};

export async function recordChainWatchWarning(
  env: Env, state: ChainWatchStateRow, stage: "warning_60" | "warning_30",
  delivery: { messageId: string; channelId: string },
): Promise<void> {
  const prefix = stage === "warning_60" ? "warning" : "critical";
  // Record delivery even if an attack changed the timer while Discord sent it.
  // A late critical joins the same cycle and inherits its already known outcome.
  await env.DB.prepare(`INSERT INTO chain_watch_warning_cycles
    (faction_id, reset_at, timeout_at, chain_length, ${prefix}_message_id, ${prefix}_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(faction_id, reset_at) DO UPDATE SET
      ${prefix}_message_id = COALESCE(chain_watch_warning_cycles.${prefix}_message_id, excluded.${prefix}_message_id),
      ${prefix}_channel_id = COALESCE(chain_watch_warning_cycles.${prefix}_channel_id, excluded.${prefix}_channel_id)`)
    .bind(state.faction_id, state.reset_at, state.timeout_at, state.current_chain, delivery.messageId, delivery.channelId).run();
}

async function resolveOutcome(env: Env, cycle: WarningCycle, state: ChainWatchStateRow | null, now: number): Promise<string | null> {
  // Ingestion can contain several hits. The first hit after the warned timer,
  // not the most recently ingested hit or polling time, identifies the saver.
  const hit = await env.DB.prepare(`SELECT attacker_name, chain, COALESCE(ended, started) AS hit_at
    FROM attacks WHERE attacker_faction_id = ?
      AND (defender_faction_id IS NULL OR defender_faction_id != ?)
      AND result IN (${POSITIVE_RESULTS_SQL}) AND chain > 0 AND chain != ?
      AND COALESCE(ended, started) > ? AND COALESCE(ended, started) <= ?
    ORDER BY COALESCE(ended, started), id LIMIT 1`)
    .bind(cycle.faction_id, cycle.faction_id, cycle.chain_length, cycle.reset_at, now)
    .first<{ attacker_name: string | null; chain: number; hit_at: number }>();
  if (hit && hit.chain === cycle.chain_length + 1 && hit.hit_at < cycle.timeout_at) {
    const name = hit.attacker_name?.replace(/\s+/g, " ").trim() || "Unknown attacker";
    return `Chain saved by ${name} with ${cycle.timeout_at - hit.hit_at} seconds remaining`;
  }
  // A larger count without the first saving attack means ingestion is behind.
  // Wait for that attack rather than attributing the save to a later attacker.
  if (hit && hit.chain > cycle.chain_length) return null;
  const confirmedDrop = state && state.last_error === null &&
    state.last_checked_at !== null && state.last_checked_at >= cycle.reset_at &&
    (Number(state.current_chain) < cycle.chain_length ||
      (Number(state.current_chain) === cycle.chain_length &&
        (state.source === "dropped" || (state.timeout_at !== null && state.timeout_at <= now && state.last_checked_at >= cycle.timeout_at))));
  return (hit && hit.chain < cycle.chain_length) || confirmedDrop
    ? `Chain length ${cycle.chain_length} was dropped` : null;
}

export async function reconcileChainWatchWarningMessages(env: Env, state: ChainWatchStateRow | null, now: number): Promise<void> {
  const pending = await env.DB.prepare(`SELECT * FROM chain_watch_warning_cycles WHERE faction_id = ? AND
    (outcome_text IS NULL OR edited_message_id IS NOT COALESCE(critical_message_id, warning_message_id)
      OR (critical_message_id IS NOT NULL AND warning_message_id IS NOT NULL AND warning_deleted_at IS NULL))`)
    .bind(HOME_FACTION_ID).all<WarningCycle>();
  for (const candidate of pending.results) {
    const token = crypto.randomUUID();
    const leaseAt = Math.max(now, nowSeconds());
    const cycle = await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET lease_token = ?, lease_until = ?
      WHERE faction_id = ? AND reset_at = ? AND (lease_until IS NULL OR lease_until <= ?) RETURNING *`)
      .bind(token, leaseAt + 60, candidate.faction_id, candidate.reset_at, leaseAt).first<WarningCycle>();
    if (!cycle) continue;
    try {
      const summary = cycle.outcome_text ?? await resolveOutcome(env, cycle, state, now);
      if (!summary) continue;
      // Persist the exact outcome before I/O. Later hits, polling, or another
      // warning cycle cannot change a retry's attacker, count or seconds left.
      await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET outcome_text = ?, resolved_at = COALESCE(resolved_at, ?)
        WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
        .bind(summary, now, cycle.faction_id, cycle.reset_at, token).run();
      const messageId = cycle.critical_message_id ?? cycle.warning_message_id;
      const channelId = cycle.critical_message_id ? cycle.critical_channel_id : cycle.warning_channel_id;
      if (!messageId || !channelId) continue;
      if (cycle.edited_message_id !== messageId) {
        // Existing warning cards are Components V2. Replace all components with
        // one short text display and remove their mentions without a new post.
        const edited = await editWatchDiscordMessage(env, channelId, messageId, {
          flags: 32768, content: null, embeds: [], components: [{ type: 10, content: summary }],
          allowed_mentions: { parse: [] },
        });
        if (edited.status === "failed") throw edited.error;
        await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET edited_message_id = ?
          WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
          .bind(messageId, cycle.faction_id, cycle.reset_at, token).run();
      }
      if (cycle.critical_message_id && cycle.warning_message_id && cycle.warning_deleted_at === null) {
        const deleted = await deleteWatchDiscordMessage(env, cycle.warning_channel_id!, cycle.warning_message_id);
        if (deleted.status === "failed") throw deleted.error;
        await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET warning_deleted_at = ?
          WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
          .bind(now, cycle.faction_id, cycle.reset_at, token).run();
      }
      await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET last_error = NULL
        WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
        .bind(cycle.faction_id, cycle.reset_at, token).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET last_error = ?
        WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
        .bind(message.slice(0, 240), cycle.faction_id, cycle.reset_at, token).run();
      console.warn("Chain Watch warning cleanup failed:", message);
    } finally {
      await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET lease_token = NULL, lease_until = NULL
        WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
        .bind(cycle.faction_id, cycle.reset_at, token).run();
    }
  }
}
