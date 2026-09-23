import { WATCH_HOUR } from "../shared/chainWatchSchedule";
import { deleteWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { readDiscordNotificationGuildId } from "./discordNotificationChannels";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export async function cleanupWatchUnfilledSlotAlerts(env: Env, now = nowSeconds()): Promise<void> {
  const guildId = readDiscordNotificationGuildId(env);
  if (!env.DISCORD_BOT_TOKEN || !guildId) return;
  const checkedAt = Math.max(now, nowSeconds());
  // Cleanup is independent of the current alert toggle/route or watch status.
  // Prioritize newly filled slots so old retry work cannot delay their cleanup.
  const rows = await env.DB.prepare(`SELECT s.watch_id, s.start_at FROM chain_watch_slots s
    JOIN chain_watch_schedules w ON w.id = s.watch_id
    WHERE w.guild_id = ? AND s.unfilled_alert_message_id IS NOT NULL
      AND s.unfilled_alert_channel_id IS NOT NULL AND s.unfilled_alert_deleted_at IS NULL
      AND s.unfilled_alert_until <= ? AND (s.assigned_to IS NOT NULL OR s.start_at <= ?)
    ORDER BY s.assigned_to IS NULL, s.start_at DESC LIMIT 30`)
    .bind(guildId, checkedAt, checkedAt - WATCH_HOUR).all<{ watch_id: string; start_at: number }>();
  const errors: unknown[] = [];
  for (const slot of rows.results) {
    const token = crypto.randomUUID();
    const deleteAt = Math.max(checkedAt, nowSeconds());
    // Share the sender's lease: a concurrent sign-up cannot delete an alert
    // until its message ID is saved, and overlapping workers delete only once.
    const claimed = await env.DB.prepare(`UPDATE chain_watch_slots
      SET unfilled_alert_token = ?, unfilled_alert_until = ?
      WHERE watch_id = ? AND start_at = ? AND unfilled_alert_until <= ?
        AND unfilled_alert_message_id IS NOT NULL AND unfilled_alert_channel_id IS NOT NULL
        AND unfilled_alert_deleted_at IS NULL AND (assigned_to IS NOT NULL OR start_at <= ?)
      RETURNING unfilled_alert_message_id, unfilled_alert_channel_id`)
      .bind(token, deleteAt + 120, slot.watch_id, slot.start_at, deleteAt, deleteAt - WATCH_HOUR)
      .first<{ unfilled_alert_message_id: string; unfilled_alert_channel_id: string }>();
    if (!claimed) continue;
    try {
      const delivery = await deleteWatchDiscordMessage(env, claimed.unfilled_alert_channel_id, claimed.unfilled_alert_message_id);
      if (delivery.status === "failed") throw delivery.error;
      // A missing message is also complete. Retain the sent marker and IDs for
      // history, and never resend or reping if the slot subsequently reopens.
      await env.DB.prepare(`UPDATE chain_watch_slots SET unfilled_alert_deleted_at = ?
        WHERE watch_id = ? AND start_at = ? AND unfilled_alert_token = ?`)
        .bind(Math.max(deleteAt, nowSeconds()), slot.watch_id, slot.start_at, token).run();
    } catch (error) {
      errors.push(error);
    } finally {
      await env.DB.prepare(`UPDATE chain_watch_slots SET unfilled_alert_token = NULL, unfilled_alert_until = 0
        WHERE watch_id = ? AND start_at = ? AND unfilled_alert_token = ?`)
        .bind(slot.watch_id, slot.start_at, token).run();
    }
  }
  if (errors.length) throw errors[0];
}
