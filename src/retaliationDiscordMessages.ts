import { createDiscordBotMessage, editDiscordBotMessage, type DiscordEmbed } from "./discord";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import { discordNotificationChannelTargetId, readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";
import { d1Changes, nowSeconds } from "./utils";

type MessageState = {
  opening_attack_id: number;
  discord_message_id: string | null;
  discord_channel_id: string | null;
  last_rendered_hash: string | null;
  last_edited_at: number | null;
  finalized_at: number | null;
};

type OpportunityMessage = {
  openingAttackId: number;
  expiresAt: number;
  terminal: boolean;
  payload: { content: string; embeds: DiscordEmbed[] };
};

const REQUEST_TIMEOUT_MS = 10_000;
const LEASE_SECONDS = 60;

export async function syncRetaliationMessages(
  env: Env, opportunities: OpportunityMessage[], checkedAt: number,
): Promise<{ edited: boolean; pending: boolean }> {
  let edited = false, pending = false;
  // Keep a tombstone through the opening's entire discovery window so a finished
  // opportunity cannot be posted again. No Discord references remain in it.
  await env.DB.prepare(`DELETE FROM retaliation_discord_messages
    WHERE finalized_at IS NOT NULL AND expires_at < ?`).bind(checkedAt - 86400).run();
  await retireLegacyBoard(env);

  for (const opportunity of opportunities) {
    const id = opportunity.openingAttackId;
    if (!opportunity.terminal) {
      await env.DB.prepare(`INSERT INTO retaliation_discord_messages (opening_attack_id, expires_at)
        VALUES (?, ?) ON CONFLICT(opening_attack_id) DO NOTHING`).bind(id, opportunity.expiresAt).run();
    }
    const leaseToken = crypto.randomUUID();
    const leaseNow = nowSeconds();
    const lease = await env.DB.prepare(`UPDATE retaliation_discord_messages
      SET lease_token = ?, lease_until = ?
      WHERE opening_attack_id = ? AND finalized_at IS NULL AND lease_until <= ?`)
      .bind(leaseToken, leaseNow + LEASE_SECONDS, id, leaseNow).run();
    if (!d1Changes(lease)) continue;
    let editingExisting = false;
    try {
      const state = await env.DB.prepare(`SELECT * FROM retaliation_discord_messages
        WHERE opening_attack_id = ? AND lease_token = ?`).bind(id, leaseToken).first<MessageState>();
      if (!state || state.finalized_at !== null) continue;

      // Do not create historical messages for already-completed opportunities,
      // including ones whose first send never succeeded before the deadline.
      if (opportunity.terminal && !state.discord_message_id) {
        await finalizeMessage(env, id, leaseToken, checkedAt);
        continue;
      }

      const hash = JSON.stringify(opportunity.payload);
      if (!opportunity.terminal && (state.last_rendered_hash === hash ||
          (state.last_edited_at !== null && state.last_edited_at > checkedAt - 5))) continue;

      if (state.discord_message_id && state.discord_channel_id) {
        editingExisting = true;
        // Always edit the original destination, even if the alert is rerouted.
        // An edit failure never creates a replacement message or repeats pings.
        await editDiscordBotMessage(env, state.discord_channel_id, state.discord_message_id,
          opportunity.payload.content, { users: [], roles: [] },
          { embeds: opportunity.payload.embeds, timeoutMs: REQUEST_TIMEOUT_MS });
        edited = true;
        if (opportunity.terminal) {
          await finalizeMessage(env, id, leaseToken, checkedAt);
          continue;
        }
        await env.DB.prepare(`UPDATE retaliation_discord_messages SET last_rendered_hash = ?, last_edited_at = ?
          WHERE opening_attack_id = ? AND lease_token = ?`).bind(hash, checkedAt, id, leaseToken).run();
      } else {
        // Recheck time after processing earlier messages in a busy batch.
        if (opportunity.expiresAt <= nowSeconds()) {
          await finalizeMessage(env, id, leaseToken, checkedAt);
          continue;
        }
        const route = await readConfiguredDiscordNotificationChannel(env, DISCORD_ALERT_KEYS.retaliationBoard);
        if (!route) { pending = true; continue; }
        const channelId = discordNotificationChannelTargetId(route);
        const mentions = await readDiscordAlertMentions(env, DISCORD_ALERT_KEYS.retaliationBoard);
        const messageId = await createDiscordBotMessage(env, channelId,
          formatDiscordAlertMessage(opportunity.payload.content, mentions.messageSuffix), mentions.allowedMentions,
          { embeds: opportunity.payload.embeds, nonce: `retal:${id}`, timeoutMs: REQUEST_TIMEOUT_MS });
        if (!messageId) { pending = true; continue; }
        await env.DB.prepare(`UPDATE retaliation_discord_messages
          SET discord_message_id = ?, discord_channel_id = ?, last_rendered_hash = ?, last_edited_at = ?
          WHERE opening_attack_id = ? AND lease_token = ?`)
          .bind(messageId, channelId, hash, checkedAt, id, leaseToken).run();
        edited = true;
      }
    } catch (error) {
      if (editingExisting && error instanceof ExternalApiError && error.status === 404) {
        // A deleted message/channel is intentionally forgotten, not reposted.
        await finalizeMessage(env, id, leaseToken, checkedAt);
      } else {
        pending = true;
        console.warn(`Retaliation message update failed for opening ${id}; will retry.`);
      }
    } finally {
      await env.DB.prepare(`UPDATE retaliation_discord_messages SET lease_token = NULL, lease_until = 0
        WHERE opening_attack_id = ? AND lease_token = ?`).bind(id, leaseToken).run();
    }
  }
  return { edited, pending };
}

async function finalizeMessage(env: Env, id: number, leaseToken: string, now: number): Promise<void> {
  await env.DB.prepare(`UPDATE retaliation_discord_messages SET
    finalized_at = ?, discord_message_id = NULL, discord_channel_id = NULL,
    last_rendered_hash = NULL, last_edited_at = NULL
    WHERE opening_attack_id = ? AND lease_token = ?`).bind(now, id, leaseToken).run();
}

async function retireLegacyBoard(env: Env): Promise<void> {
  const state = await env.DB.prepare(`SELECT discord_message_id, discord_target_id FROM retaliation_board_state
    WHERE id = 1 AND discord_message_id IS NOT NULL`)
    .first<{ discord_message_id: string; discord_target_id: string | null }>();
  if (!state) return;
  const channelId = state.discord_target_id?.match(/^bot:(\d+)$/)?.[1];
  if (channelId) {
    try {
      await editDiscordBotMessage(env, channelId, state.discord_message_id,
        "**Retaliation alerts**\nEach new retaliation opportunity now has its own message. This board is no longer updated.",
        { users: [], roles: [] }, { embeds: [], timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof ExternalApiError && error.status === 404)) {
        console.warn("Unable to retire the legacy retaliation board; will retry.");
        return;
      }
    }
  }
  await env.DB.prepare(`UPDATE retaliation_board_state SET discord_message_id = NULL, discord_target_id = NULL,
    last_rendered_hash = NULL, last_edited_at = NULL WHERE id = 1 AND discord_message_id = ?`)
    .bind(state.discord_message_id).run();
}
