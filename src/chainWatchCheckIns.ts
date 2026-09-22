import { remainingWatchShift } from "../shared/chainWatchShifts";
import { readWatchAssignmentBlocks, validAssignment } from "./chainWatchAssignments";
import { reminderPayload, escalationPayload, escapeText } from "./chainWatchCheckInMessages";
import { REMINDER_LEAD, ESCALATION_LEAD, TAKEOVER_LEAD, RESPONSE_WINDOW, CLEANUP_DELAY,
  WATCH_CHECK_IN_PREFIX, WATCH_TAKE_OVER_PREFIX, WATCH_TAKE_OVER_CONFIRM_PREFIX, reminderCleanupAt, type WatchCheckIn as CheckIn } from "./chainWatchCheckInModel";
import { WATCH_HOUR, watchUtc } from "../shared/chainWatchSchedule";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import { discordNotificationChannelTargetId, readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { deleteWatchDiscordMessage, editWatchDiscordMessage, sendWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import type { Env } from "./types";
import { nowSeconds } from "./utils";
import { WatchError, watchDiscordMember, watchFailure } from "./chainWatchSchedule";

export { WATCH_CHECK_IN_PREFIX, WATCH_TAKE_OVER_PREFIX, WATCH_TAKE_OVER_CONFIRM_PREFIX } from "./chainWatchCheckInModel";

const availableForTakeover = `confirmed_at IS NULL AND cancelled_at IS NULL AND closed_at IS NULL
  AND end_at > unixepoch() AND escalation_kind = 'missed' AND escalation_sent_at IS NOT NULL
  AND start_at - ${TAKEOVER_LEAD} <= unixepoch()
  AND reminder_sent_at IS NOT NULL AND ${validAssignment}
  AND NOT EXISTS (SELECT 1 FROM chain_watch_takeovers taken
    WHERE taken.check_in_id = chain_watch_check_ins.id AND taken.confirmed_at IS NOT NULL)`;

export function isWatchCheckInInteraction(interaction: DiscordInteraction): boolean {
  return interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_CHECK_IN_PREFIX));
}

export function isWatchTakeoverInteraction(interaction: DiscordInteraction): boolean {
  return interaction.type === 3 && (Boolean(interaction.data?.custom_id?.startsWith(WATCH_TAKE_OVER_PREFIX)) || isWatchTakeoverConfirmation(interaction));
}

export function isWatchTakeoverConfirmation(interaction: DiscordInteraction): boolean {
  return interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_TAKE_OVER_CONFIRM_PREFIX));
}

export async function runWatchCheckIns(env: Env, now = nowSeconds()): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return;
  const checkedAt = Math.max(now, nowSeconds());
  await env.DB.prepare("DELETE FROM chain_watch_takeovers WHERE confirmed_at IS NULL AND expires_at <= ?").bind(checkedAt).run();
  const blocks = await readWatchAssignmentBlocks(env);
  // Keep contiguous hours as one shift, including across midnight's daily sheets.
  for (const block of blocks) {
    if (block.start_at > checkedAt + REMINDER_LEAD || block.end_at <= checkedAt) continue;
    await env.DB.prepare(`INSERT INTO chain_watch_check_ins
      (id, watch_id, start_at, end_at, assignment_revision, assigned_to, discord_user_id,
       guild_id, channel_id, watch_name, member_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(watch_id, start_at, assignment_revision) DO UPDATE SET
        end_at = excluded.end_at, discord_user_id = excluded.discord_user_id,
        dirty = chain_watch_check_ins.dirty + CASE WHEN chain_watch_check_ins.end_at != excluded.end_at THEN 1 ELSE 0 END`)
      .bind(crypto.randomUUID(), block.watch_id, block.start_at, block.end_at, block.check_in_revision,
        block.assigned_to, block.discord_user_id, block.guild_id, block.channel_id, block.watch_name, block.member_name, checkedAt).run();
  }
  await env.DB.prepare(`UPDATE chain_watch_check_ins SET closed_at = ?, dirty = dirty + 1
    WHERE closed_at IS NULL AND end_at <= ?`).bind(checkedAt, checkedAt).run();
  await env.DB.prepare(`UPDATE chain_watch_check_ins SET cancelled_at = ?, dirty = dirty + 1
    WHERE closed_at IS NULL AND cancelled_at IS NULL AND NOT (${validAssignment})`).bind(checkedAt).run();
  const rows = await env.DB.prepare(`SELECT id FROM chain_watch_check_ins
    WHERE guild_id = ? AND ((closed_at IS NULL AND cancelled_at IS NULL) OR dirty > 0)
    ORDER BY start_at DESC LIMIT 30`).bind(env.DISCORD_GUILD_ID).all<{ id: string }>();
  const errors: unknown[] = [];
  for (const row of rows.results) {
    try { await processCheckIn(env, row.id); }
    catch (error) { errors.push(error); }
  }
  // Closed, clean rows leave the ordinary render queue but still need deletion.
  // Read them separately so old cleanup cannot crowd out active reminders.
  const cleanup = await env.DB.prepare(`SELECT id FROM chain_watch_check_ins WHERE guild_id = ? AND (
    (reminder_message_id IS NOT NULL AND reminder_deleted_at IS NULL AND
      (cancelled_at <= ? OR (cancelled_at IS NULL AND confirmed_at IS NOT NULL AND end_at <= ?))) OR
    (escalation_message_id IS NOT NULL AND escalation_deleted_at IS NULL AND cancelled_at <= ?))
    ORDER BY COALESCE(cancelled_at, end_at), id LIMIT 30`)
    .bind(env.DISCORD_GUILD_ID, checkedAt - CLEANUP_DELAY, checkedAt - CLEANUP_DELAY, checkedAt - CLEANUP_DELAY)
    .all<{ id: string }>();
  const attempted = new Set(rows.results.map(row => row.id));
  for (const row of cleanup.results) {
    if (attempted.has(row.id)) continue;
    try { await processCheckIn(env, row.id); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw errors[0];
}

async function readCheckIn(env: Env, id: string): Promise<CheckIn | null> {
  return env.DB.prepare(`SELECT c.*, t.member_id AS taken_over_by, t.member_name AS taken_over_name,
      t.confirmed_at AS taken_over_at, t.start_at AS taken_over_start_at, t.end_at AS taken_over_end_at
    FROM chain_watch_check_ins c LEFT JOIN chain_watch_takeovers t ON t.check_in_id = c.id AND t.confirmed_at IS NOT NULL
    WHERE c.id = ?`).bind(id).first<CheckIn>();
}

async function isCurrent(env: Env, id: string): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT id FROM chain_watch_check_ins WHERE id = ?
    AND cancelled_at IS NULL AND closed_at IS NULL AND end_at > unixepoch() AND ${validAssignment}`).bind(id).first());
}

function nextTakeoverAlarm(row: CheckIn | null): number | null {
  if (!row || row.escalation_kind !== "missed" || !row.escalation_sent_at || row.takeover_button_shown ||
      row.confirmed_at !== null || row.cancelled_at !== null || row.closed_at !== null || row.end_at <= nowSeconds()) return null;
  return Math.max(row.start_at - TAKEOVER_LEAD, nowSeconds() + 1);
}

async function scheduleTakeoverAlarm(env: Env, id: string): Promise<void> {
  const row = await readCheckIn(env, id);
  if (!row || row.escalation_kind !== "missed") return;
  const stub = env.CHAIN_WATCH_ALARMS.getByName(`chain-watch-check-in:${id}`) as DurableObjectStub & {
    scheduleCheckIn(checkInId: string, alarmAtSeconds: number): Promise<void>;
    cancel(): Promise<void>;
  };
  const next = nextTakeoverAlarm(row);
  if (next !== null) await stub.scheduleCheckIn(id, next);
  else await stub.cancel();
}

export async function handleWatchCheckInAlarm(env: Env, id: string): Promise<number | null> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return null;
  const row = await readCheckIn(env, id);
  if (!row || row.guild_id !== env.DISCORD_GUILD_ID || nextTakeoverAlarm(row) === null) return null;
  // An admin may have finished the watch since the last cron tick. Never
  // expose a takeover for an assignment which is no longer active.
  if (!await isCurrent(env, id)) {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET cancelled_at = COALESCE(cancelled_at, ?), dirty = dirty + 1 WHERE id = ?")
      .bind(nowSeconds(), id).run();
  }
  await processCheckIn(env, id, false);
  return nextTakeoverAlarm(await readCheckIn(env, id));
}

async function processCheckIn(env: Env, id: string, scheduleAlarm = true): Promise<void> {
  const token = crypto.randomUUID();
  const lease = await env.DB.prepare(`UPDATE chain_watch_check_ins SET lease_token = ?, lease_until = ?
    WHERE id = ? AND lease_until <= ?`).bind(token, nowSeconds() + 120, id, nowSeconds()).run();
  if (!lease.meta.changes) {
    if (scheduleAlarm) await scheduleTakeoverAlarm(env, id);
    return;
  }
  try {
    let row = (await readCheckIn(env, id))!;
    if (await isCurrent(env, id)) {
      if (!row.reminder_sent_at && !row.confirmed_at) await sendReminder(env, row);
      row = (await readCheckIn(env, id))!;
      const deadline = Math.max(row.start_at - ESCALATION_LEAD, (row.reminder_sent_at ?? 0) + RESPONSE_WINDOW);
      if (!row.confirmed_at && !row.escalation_sent_at && nowSeconds() >= deadline) await sendEscalation(env, row);
      await env.DB.prepare(`UPDATE chain_watch_check_ins SET dirty = dirty + 1
        WHERE id = ? AND takeover_button_shown = 0 AND ${availableForTakeover}`).bind(id).run();
    }
    // Reread after sends: a check-in or reassignment may have arrived during HTTP.
    row = (await readCheckIn(env, id))!;
    await cleanupCheckIn(env, row);
    row = (await readCheckIn(env, id))!;
    if (row.dirty > 0) await renderCheckIn(env, row);
  } finally {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?")
      .bind(id, token).run();
    if (scheduleAlarm) await scheduleTakeoverAlarm(env, id);
  }
}

async function sendReminder(env: Env, row: CheckIn): Promise<void> {
  // Resolve again at dispatch; a link may have changed since the schedule read.
  const linked = await env.DB.prepare(`SELECT links.discord_user_id FROM discord_member_links links
    JOIN home_faction_members m ON m.member_id = links.torn_user_id
    WHERE links.torn_user_id = ? AND m.is_current = 1`).bind(row.assigned_to).first<{ discord_user_id: string }>();
  const discordId = linked?.discord_user_id.trim();
  row.discord_user_id = discordId && /^\d{5,32}$/.test(discordId) ? discordId : null;
  await env.DB.prepare("UPDATE chain_watch_check_ins SET discord_user_id = ? WHERE id = ?").bind(row.discord_user_id, row.id).run();
  if (!row.discord_user_id) {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET reminder_error = 'No linked Discord account for a current faction member' WHERE id = ?")
      .bind(row.id).run();
    return;
  }
  if (!await isCurrent(env, row.id)) return;
  const delivery = await sendWatchDiscordMessage(env, row.channel_id, {
    ...reminderPayload(row, nowSeconds()), content: `<@${row.discord_user_id}>`,
    allowed_mentions: { parse: [], users: [row.discord_user_id], roles: [] },
  }, `${row.id}:reminder`);
  if (delivery.status === "success") {
    await env.DB.prepare(`UPDATE chain_watch_check_ins SET reminder_message_id = ?, reminder_sent_at = ?,
      reminder_error = NULL, dirty = dirty + 1 WHERE id = ?`).bind(delivery.value, nowSeconds(), row.id).run();
  } else {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET reminder_error = ? WHERE id = ?")
      .bind(delivery.error.message.slice(0, 240), row.id).run();
    console.error("Chain watch check-in reminder will retry", row.id);
  }
}

async function sendEscalation(env: Env, row: CheckIn): Promise<void> {
  const alertKey = DISCORD_ALERT_KEYS.chainWatchMissedCheckIn;
  if (!await isDiscordAlertEnabled(env, alertKey)) return;
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) return;
  const mentions = await readDiscordAlertMentions(env, alertKey);
  const current = await readCheckIn(env, row.id);
  if (!current || current.confirmed_at || current.escalation_sent_at || !await isCurrent(env, row.id)) return;
  const kind = current.reminder_sent_at ? "missed" : "delivery_failed";
  const channelId = discordNotificationChannelTargetId(route);
  const delivery = await sendWatchDiscordMessage(env, channelId, {
    ...escalationPayload({ ...current, escalation_kind: kind }, nowSeconds()), content: mentions.messageSuffix,
    allowed_mentions: { parse: mentions.allowedMentions?.everyone ? ["everyone"] : [],
      users: mentions.allowedMentions?.users ?? [], roles: mentions.allowedMentions?.roles ?? [] },
  }, `${row.id}:escalation`);
  if (delivery.status === "failed") throw delivery.error;
  await env.DB.prepare(`UPDATE chain_watch_check_ins SET escalation_message_id = ?, escalation_channel_id = ?,
    escalation_sent_at = ?, escalation_kind = ?, dirty = dirty + 1 WHERE id = ?`)
    .bind(delivery.value, channelId, nowSeconds(), kind, row.id).run();
}

async function cleanupCheckIn(env: Env, row: CheckIn): Promise<void> {
  // Remove obsolete alerts first, so a failed alert deletion keeps its reminder
  // available. Confirmed-but-valid assignments only delete the reminder.
  const messages = [
    { channel: row.escalation_channel_id, id: row.escalation_message_id, deleted: row.escalation_deleted_at,
      at: row.cancelled_at === null ? null : row.cancelled_at + CLEANUP_DELAY, column: "escalation_deleted_at" },
    { channel: row.channel_id, id: row.reminder_message_id, deleted: row.reminder_deleted_at,
      at: reminderCleanupAt(row), column: "reminder_deleted_at" },
  ] as const;
  for (const message of messages) {
    if (!message.channel || !message.id || message.deleted !== null || message.at === null || message.at > nowSeconds()) continue;
    const delivery = await deleteWatchDiscordMessage(env, message.channel, message.id);
    if (delivery.status === "failed") throw delivery.error;
    // Keep IDs and confirmation history for audit; a durable marker prevents
    // repeated deletes and future edits of a message already removed.
    await env.DB.prepare(`UPDATE chain_watch_check_ins SET ${message.column} = ?, dirty = dirty + 1 WHERE id = ?`)
      .bind(nowSeconds(), row.id).run();
  }
}

async function renderCheckIn(env: Env, row: CheckIn): Promise<void> {
  // Suppress mentions on edits; confirmed reminders also clear the original ping
  // so the message contains only the compact confirmation block.
  const alertPayload = escalationPayload(row, nowSeconds());
  for (const [channel, message, deleted, payload] of [
    [row.channel_id, row.reminder_message_id, row.reminder_deleted_at, reminderPayload(row, nowSeconds())],
    [row.escalation_channel_id, row.escalation_message_id, row.escalation_deleted_at, alertPayload],
  ] as const) {
    if (!channel || !message || deleted !== null) continue;
    const delivery = await editWatchDiscordMessage(env, channel, message, payload);
    if (delivery.status === "failed") throw delivery.error;
  }
  // A concurrent confirmation increments dirty and must remain queued for rendering.
  const buttonShown = alertPayload.components.length > 0 ? 1 : row.takeover_button_shown;
  await env.DB.prepare("UPDATE chain_watch_check_ins SET dirty = MAX(0, dirty - ?), takeover_button_shown = ? WHERE id = ?")
    .bind(row.dirty, buttonShown, row.id).run();
}

export async function confirmWatchCheckIn(interaction: DiscordInteraction, env: Env): Promise<DiscordInteractionResponse> {
  const reply = (content: string): DiscordInteractionResponse => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
  const userId = interaction.member?.user?.id;
  const id = interaction.data?.custom_id?.slice(WATCH_CHECK_IN_PREFIX.length);
  if (!isWatchCheckInInteraction(interaction) || !id || !userId || !env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID) {
    return reply("Use the check-in button in the faction Discord server.");
  }
  const now = nowSeconds();
  const result = await env.DB.prepare(`UPDATE chain_watch_check_ins
    SET confirmed_at = COALESCE(confirmed_at, ?), dirty = dirty + CASE WHEN confirmed_at IS NULL THEN 1 ELSE 0 END
    WHERE id = ? AND guild_id = ? AND channel_id = ? AND reminder_message_id = ?
      AND reminder_sent_at IS NOT NULL AND reminder_sent_at <= ? AND end_at > ?
      AND cancelled_at IS NULL AND closed_at IS NULL AND ${validAssignment}
      AND EXISTS (SELECT 1 FROM discord_member_links links JOIN home_faction_members m ON m.member_id = links.torn_user_id
        WHERE links.torn_user_id = chain_watch_check_ins.assigned_to AND links.discord_user_id = ? AND m.is_current = 1)
    RETURNING id`).bind(now, id, interaction.guild_id, interaction.channel_id ?? "", interaction.message?.id ?? "", now, now, userId).first();
  if (!result) return reply("Only the currently assigned watcher can check in using their current reminder. This assignment may have changed or ended.");
  try { await processCheckIn(env, id); }
  catch { console.error("Confirmed chain watch check-in; message update will retry", id); }
  return { type: 6 };
}

export async function handleWatchTakeover(interaction: DiscordInteraction, env: Env): Promise<DiscordInteractionResponse> {
  const confirming = isWatchTakeoverConfirmation(interaction);
  const reply = (content: string, components: NonNullable<DiscordInteractionResponse["data"]>["components"] = []): DiscordInteractionResponse => ({
    type: confirming ? 7 : 4,
    data: { content, components, ...(!confirming ? { flags: 64 } : {}), allowed_mentions: { parse: [] } },
  });
  const userId = interaction.member?.user?.id;
  if (!userId || !interaction.channel_id || !env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID) {
    return reply("Use Take over in the faction Discord server.");
  }
  const memberId = await watchDiscordMember(env, userId);
  const unavailable = "This shift is no longer available to take over. The watcher may have checked in, someone else may have taken over, or the assignment changed or ended.";
  if (!confirming) {
    const id = interaction.data!.custom_id!.slice(WATCH_TAKE_OVER_PREFIX.length);
    const available = await env.DB.prepare(`SELECT id FROM chain_watch_check_ins WHERE id = ?
      AND guild_id = ? AND escalation_channel_id = ? AND escalation_message_id = ? AND ${availableForTakeover}`)
      .bind(id, interaction.guild_id, interaction.channel_id, interaction.message?.id ?? "").first();
    if (!available) return reply(unavailable);
    const row = (await readCheckIn(env, id))!;
    if (row.assigned_to === memberId) return reply("This is your assigned shift. Use the I’m ready button on your check-in reminder.");
    const member = await env.DB.prepare("SELECT name FROM home_faction_members WHERE member_id = ? AND is_current = 1")
      .bind(memberId).first<{ name: string }>();
    if (!member) throw new WatchError("Only current faction members can take over shifts.");
    const now = nowSeconds();
    const { start_at: from } = remainingWatchShift(row, now);
    const token = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO chain_watch_takeovers
      (id, check_in_id, member_id, member_name, discord_user_id, guild_id, channel_id, start_at, end_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(token, id, memberId, member.name, userId, interaction.guild_id, interaction.channel_id, from, row.end_at, Math.min(now + 300, row.end_at)).run();
    return reply(`Take over from **${escapeText(row.member_name)}**?\nShift: ${watchUtc(from)} – ${watchUtc(row.end_at)}\n` +
      `${from <= now ? "You’ll cover the rest of the current hour and any remaining hours shown." : "You’ll cover the full shift shown."}\n` +
      "Confirming assigns this shift to you and checks you in immediately. This confirmation expires in five minutes or when the remaining shift changes.",
    [{ type: 1, components: [{ type: 2, style: 3, label: "Confirm takeover", custom_id: `${WATCH_TAKE_OVER_CONFIRM_PREFIX}${token}` }] }]);
  }

  const token = interaction.data!.custom_id!.slice(WATCH_TAKE_OVER_CONFIRM_PREFIX.length);
  let result: { check_in_id: string } | null;
  try {
    // Recheck ownership, membership, scope and check-in in the same statement
    // that transfers the slots. The trigger also enforces the break rule.
    result = await env.DB.prepare(`UPDATE chain_watch_takeovers SET confirmed_at = unixepoch()
      WHERE id = ? AND member_id = ? AND discord_user_id = ? AND guild_id = ? AND channel_id = ?
        AND confirmed_at IS NULL AND expires_at > unixepoch()
        AND EXISTS (SELECT 1 FROM discord_member_links links JOIN home_faction_members m ON m.member_id = links.torn_user_id
          WHERE links.torn_user_id = chain_watch_takeovers.member_id AND links.discord_user_id = chain_watch_takeovers.discord_user_id AND m.is_current = 1)
        AND EXISTS (SELECT 1 FROM chain_watch_check_ins
          WHERE id = chain_watch_takeovers.check_in_id AND assigned_to != chain_watch_takeovers.member_id
            AND guild_id = chain_watch_takeovers.guild_id AND escalation_channel_id = chain_watch_takeovers.channel_id
            AND chain_watch_takeovers.start_at = MAX(start_at, unixepoch() - unixepoch() % ${WATCH_HOUR})
            AND chain_watch_takeovers.end_at = end_at AND ${availableForTakeover})
        AND (SELECT COUNT(*) FROM chain_watch_slots s JOIN chain_watch_check_ins c ON c.watch_id = s.watch_id
          WHERE c.id = chain_watch_takeovers.check_in_id AND s.start_at >= chain_watch_takeovers.start_at
            AND s.start_at < chain_watch_takeovers.end_at AND s.assigned_to = c.assigned_to AND s.cancelled = 0)
          = (end_at - start_at) / ${WATCH_HOUR}
      RETURNING check_in_id`).bind(token, memberId, userId, interaction.guild_id, interaction.channel_id).first<{ check_in_id: string }>();
  } catch (error) { throw watchFailure(error); }
  if (!result) return reply(`${unavailable} If this confirmation expired, open Take over again.`);
  // State is already committed. Discord failures leave dirty records for cron.
  try { await runWatchCheckIns(env); }
  catch { console.error("Chain watch takeover saved; message updates will retry", result.check_in_id); }
  return reply("You’ve taken over the shift and are checked in. The chain watch sheet and alerts will show you as the watcher.");
}
