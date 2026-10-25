import type { ChainWatchStateRow } from "./chainWatch";
import { editWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { fetchChainWatchTargets } from "./chainWatchTargets";
import { reconcileChainWatchWarningMessages } from "./chainWatchWarningCleanup";
import { POSITIVE_RESULTS_SQL } from "./constants";
import { discordCardPayload } from "./discord";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export type ChainWatchWarningTargetJob = {
  factionId: number;
  resetAt: number;
  timeoutAt: number;
  chainLength: number;
  timerVersion: number;
  stage: "warning_60" | "warning_30";
  messageId: string;
  channelId: string;
  message: string;
  cardColor: number;
};

/** Best-effort enrichment of an already sent warning; never posts or retries an alert. */
export async function enrichChainWatchWarningTargets(env: Env, job: ChainWatchWarningTargetJob): Promise<void> {
  try {
    if (!await warningStillActive(env, job)) return;
    // Fetch outside the cleanup lease. A slow lookup must not hold up a saving hit.
    const targets = await fetchChainWatchTargets(env);
    if (targets.status !== "ok") return;
    const ids = [...new Set(targets.target_ids.filter(id => Number.isSafeInteger(id) && id > 0))];
    const selected: number[] = [];
    while (ids.length && selected.length < 2) selected.push(ids.splice(Math.floor(Math.random() * ids.length), 1)[0]);
    if (!selected.length || nowSeconds() >= job.timeoutAt) return;

    // Use exactly the same per-cycle lease as saved/dropped cleanup. Do not wait
    // for a busy lease: the optional target links must yield to the outcome edit.
    const token = crypto.randomUUID();
    const now = nowSeconds();
    const leased = await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET lease_token = ?, lease_until = ?
      WHERE faction_id = ? AND reset_at = ? AND outcome_text IS NULL
        AND (lease_until IS NULL OR lease_until <= ?) RETURNING faction_id`)
      .bind(token, now + 60, job.factionId, job.resetAt, now).first();
    if (!leased) return;
    try {
      // Repeat all guards after the lookup and after acquiring the lease. A new
      // timer, saving attack, critical warning or cleanup can make this job stale.
      if (!await warningStillActive(env, job, token)) return;
      const card = discordCardPayload(job.message, job.cardColor);
      const edited = await editWatchDiscordMessage(env, job.channelId, job.messageId, {
        ...card, content: null, embeds: [],
        components: [...(card.components ?? []), {
          type: 1,
          components: selected.map((id, index) => ({
            type: 2, style: 5, label: `${index === 0 ? "Attack" : "Backup"} ${id}`,
            url: `https://www.torn.com/page.php?sid=attack&user2ID=${id}`,
          })),
        }],
        allowed_mentions: { parse: [], users: [], roles: [] },
      });
      // A deleted message stays deleted. An edit failure never retries the alert.
      if (edited.status === "failed") console.warn("Chain Watch target link edit failed");
    } finally {
      await env.DB.prepare(`UPDATE chain_watch_warning_cycles SET lease_token = NULL, lease_until = NULL
        WHERE faction_id = ? AND reset_at = ? AND lease_token = ?`)
        .bind(job.factionId, job.resetAt, token).run();
      // Cleanup may have skipped this cycle while the PATCH was in flight.
      // Re-read state so a save/drop during the edit is finalized immediately.
      const state = await env.DB.prepare("SELECT * FROM faction_chain_watch_state WHERE faction_id = ?")
        .bind(job.factionId).first<ChainWatchStateRow>();
      await reconcileChainWatchWarningMessages(env, state, nowSeconds());
    }
  } catch {
    // This optional background task must never turn a delivered warning into an
    // alarm failure (which would make the Durable Object retry its alarm).
    console.warn("Chain Watch target enrichment failed");
  }
}

async function warningStillActive(env: Env, job: ChainWatchWarningTargetJob, token: string | null = null): Promise<boolean> {
  const now = nowSeconds();
  if (now >= job.timeoutAt) return false;
  const prefix = job.stage === "warning_60" ? "warning" : "critical";
  const row = await env.DB.prepare(`SELECT c.faction_id FROM chain_watch_warning_cycles c
    JOIN faction_chain_watch_state s ON s.faction_id = c.faction_id
    WHERE c.faction_id = ? AND c.reset_at = ? AND c.timeout_at = ? AND c.chain_length = ?
      AND c.${prefix}_message_id = ? AND c.${prefix}_channel_id = ? AND c.outcome_text IS NULL
      AND s.enabled = 1 AND s.source != 'dropped' AND s.timer_version = ?
      AND s.reset_at = c.reset_at AND s.timeout_at = c.timeout_at AND s.current_chain = c.chain_length
      AND s.timeout_at > ? AND s.drop_sent_at IS NULL
      ${job.stage === "warning_60" ? "AND c.warning_deleted_at IS NULL AND c.critical_message_id IS NULL AND s.warning_30_sent_at IS NULL" : ""}
      AND (? IS NULL OR (c.lease_token = ? AND c.lease_until > ?))
      AND NOT EXISTS (SELECT 1 FROM attacks a WHERE a.attacker_faction_id = c.faction_id
        AND (a.defender_faction_id IS NULL OR a.defender_faction_id != c.faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL}) AND a.chain > 0 AND a.chain != c.chain_length
        AND COALESCE(a.ended, a.started) > c.reset_at AND COALESCE(a.ended, a.started) <= ?)`)
    .bind(job.factionId, job.resetAt, job.timeoutAt, job.chainLength, job.messageId, job.channelId,
      job.timerVersion, now, token, token, now, now).first();
  return row !== null;
}
