import { WATCH_HOUR, watchUtc } from "../shared/chainWatchSchedule";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import { discordNotificationChannelTargetId, readConfiguredDiscordNotificationChannel } from "./discordNotificationChannels";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { patchDiscordBotJson, postDiscordBotJsonAndRead } from "./external/discord";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export const WATCH_CHECK_IN_PREFIX = "cws:checkin:";
const REMINDER_LEAD = 180;
const ESCALATION_LEAD = 60;
const RESPONSE_WINDOW = 120;
const noMentions = { parse: [], users: [], roles: [] };

type Block = {
  watch_id: string; start_at: number; end_at: number; check_in_revision: number; assigned_to: number;
  discord_user_id: string | null; guild_id: string; channel_id: string; watch_name: string; member_name: string;
};
type CheckIn = Omit<Block, "check_in_revision"> & {
  id: string; assignment_revision: number; reminder_message_id: string | null; reminder_sent_at: number | null;
  confirmed_at: number | null; escalation_message_id: string | null; escalation_channel_id: string | null;
  escalation_sent_at: number | null; escalation_kind: string | null; reminder_error: string | null;
  cancelled_at: number | null; closed_at: number | null; dirty: number;
};

// Used both by the sender and the confirmation UPDATE. The revision invalidates
// old buttons even when a slot changes A -> B -> A between scheduler ticks.
const validAssignment = `EXISTS (
  SELECT 1 FROM chain_watch_slots s JOIN chain_watch_schedules w ON w.id = s.watch_id
  WHERE s.watch_id = chain_watch_check_ins.watch_id AND s.start_at = chain_watch_check_ins.start_at
    AND s.check_in_revision = chain_watch_check_ins.assignment_revision
    AND s.assigned_to = chain_watch_check_ins.assigned_to AND s.cancelled = 0
    AND w.is_open = 1 AND w.guild_id = chain_watch_check_ins.guild_id
    AND s.start_at >= w.start_at AND (w.finish_at IS NULL OR w.finish_at > unixepoch())
    AND (w.finish_at IS NULL OR s.start_at < w.finish_at)
    AND NOT EXISTS (SELECT 1 FROM chain_watch_slots previous WHERE previous.watch_id = s.watch_id
      AND previous.start_at = s.start_at - ${WATCH_HOUR} AND previous.cancelled = 0
      AND previous.assigned_to = s.assigned_to)
    AND (unixepoch() < s.start_at OR (
      EXISTS (SELECT 1 FROM chain_watch_slots current WHERE current.watch_id = s.watch_id
        AND current.start_at = unixepoch() - unixepoch() % ${WATCH_HOUR}
        AND current.assigned_to = s.assigned_to AND current.cancelled = 0)
      AND NOT EXISTS (SELECT 1 FROM chain_watch_slots gap WHERE gap.watch_id = s.watch_id
        AND gap.start_at > s.start_at AND gap.start_at <= unixepoch()
        AND (gap.assigned_to IS NOT s.assigned_to OR gap.cancelled = 1))
    ))
)`;

export function isWatchCheckInInteraction(interaction: DiscordInteraction): boolean {
  return interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_CHECK_IN_PREFIX));
}

export async function runWatchCheckIns(env: Env, now = nowSeconds()): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return;
  const checkedAt = Math.max(now, nowSeconds());
  const blocks = await readBlocks(env);
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
  if (errors.length) throw errors[0];
}

async function readBlocks(env: Env): Promise<Block[]> {
  const rows = await env.DB.prepare(`SELECT s.watch_id, s.start_at, s.check_in_revision, s.assigned_to,
      w.guild_id, w.channel_id, w.name AS watch_name, COALESCE(m.name, 'Player ' || s.assigned_to) AS member_name,
      CASE WHEN m.is_current = 1 THEN links.discord_user_id ELSE NULL END AS discord_user_id
    FROM chain_watch_slots s JOIN chain_watch_schedules w ON w.id = s.watch_id
    LEFT JOIN home_faction_members m ON m.member_id = s.assigned_to
    LEFT JOIN discord_member_links links ON links.torn_user_id = s.assigned_to
    WHERE w.is_open = 1 AND w.guild_id = ? AND s.cancelled = 0 AND s.assigned_to IS NOT NULL
      AND s.start_at >= w.start_at AND (w.finish_at IS NULL OR s.start_at < w.finish_at)
    ORDER BY s.watch_id, s.start_at`).bind(env.DISCORD_GUILD_ID).all<Block>();
  const blocks: Block[] = [];
  for (const row of rows.results) {
    const previous = blocks.at(-1);
    if (previous && previous.watch_id === row.watch_id && previous.assigned_to === row.assigned_to && previous.end_at === row.start_at) {
      previous.end_at += WATCH_HOUR;
    } else {
      const id = row.discord_user_id?.trim();
      blocks.push({ ...row, end_at: row.start_at + WATCH_HOUR, discord_user_id: id && /^\d{5,32}$/.test(id) ? id : null });
    }
  }
  return blocks;
}

async function readCheckIn(env: Env, id: string): Promise<CheckIn | null> {
  return env.DB.prepare("SELECT * FROM chain_watch_check_ins WHERE id = ?").bind(id).first<CheckIn>();
}

async function isCurrent(env: Env, id: string): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT id FROM chain_watch_check_ins WHERE id = ?
    AND cancelled_at IS NULL AND closed_at IS NULL AND end_at > unixepoch() AND ${validAssignment}`).bind(id).first());
}

async function processCheckIn(env: Env, id: string): Promise<void> {
  const token = crypto.randomUUID();
  const lease = await env.DB.prepare(`UPDATE chain_watch_check_ins SET lease_token = ?, lease_until = ?
    WHERE id = ? AND lease_until <= ?`).bind(token, nowSeconds() + 120, id, nowSeconds()).run();
  if (!lease.meta.changes) return;
  try {
    let row = (await readCheckIn(env, id))!;
    if (await isCurrent(env, id)) {
      if (!row.reminder_sent_at && !row.confirmed_at) await sendReminder(env, row);
      row = (await readCheckIn(env, id))!;
      const deadline = Math.max(row.start_at - ESCALATION_LEAD, (row.reminder_sent_at ?? 0) + RESPONSE_WINDOW);
      if (!row.confirmed_at && !row.escalation_sent_at && nowSeconds() >= deadline) await sendEscalation(env, row);
    }
    // Reread after sends: a check-in or reassignment may have arrived during HTTP.
    row = (await readCheckIn(env, id))!;
    if (row.dirty > 0) await renderCheckIn(env, row);
  } finally {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?")
      .bind(id, token).run();
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
  try {
    const message = await postDiscordBotJsonAndRead<{ id: string }>(env.DISCORD_BOT_TOKEN!, `/channels/${row.channel_id}/messages`, {
      ...reminderPayload(row), content: `<@${row.discord_user_id}>`,
      allowed_mentions: { parse: [], users: [row.discord_user_id], roles: [] },
      nonce: await messageNonce(row.id, "reminder"), enforce_nonce: true,
    }, { timeoutMs: 10_000 });
    if (!message.id) throw new Error("Discord did not return a check-in reminder message ID");
    await env.DB.prepare(`UPDATE chain_watch_check_ins SET reminder_message_id = ?, reminder_sent_at = ?,
      reminder_error = NULL, dirty = dirty + 1 WHERE id = ?`).bind(message.id, nowSeconds(), row.id).run();
  } catch (error) {
    await env.DB.prepare("UPDATE chain_watch_check_ins SET reminder_error = ? WHERE id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 240), row.id).run();
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
  const message = await postDiscordBotJsonAndRead<{ id: string }>(env.DISCORD_BOT_TOKEN!, `/channels/${channelId}/messages`, {
    ...escalationPayload({ ...current, escalation_kind: kind }), content: mentions.messageSuffix,
    allowed_mentions: { parse: mentions.allowedMentions?.everyone ? ["everyone"] : [],
      users: mentions.allowedMentions?.users ?? [], roles: mentions.allowedMentions?.roles ?? [] },
    nonce: await messageNonce(row.id, "escalation"), enforce_nonce: true,
  }, { timeoutMs: 10_000 });
  if (!message.id) throw new Error("Discord did not return a missed check-in message ID");
  await env.DB.prepare(`UPDATE chain_watch_check_ins SET escalation_message_id = ?, escalation_channel_id = ?,
    escalation_sent_at = ?, escalation_kind = ?, dirty = dirty + 1 WHERE id = ?`)
    .bind(message.id, channelId, nowSeconds(), kind, row.id).run();
}

function shiftText(row: CheckIn): string {
  return `**${escapeText(row.watch_name)}**\nWatcher: ${escapeText(row.member_name)}\nShift: ${watchUtc(row.start_at)} – ${watchUtc(row.end_at)}`;
}
function reminderPayload(row: CheckIn) {
  if (row.confirmed_at !== null && row.cancelled_at === null) {
    const from = new Date(row.start_at * 1000).toISOString().slice(11, 16);
    const to = new Date(row.end_at * 1000).toISOString().slice(11, 16);
    return {
      content: "",
      embeds: [{
        description: `${escapeText(row.watch_name)} - **Chain watch check-in**\nWatcher: ${escapeText(row.member_name)} - Ready ✅\nShift: ${from} - ${to} UTC`,
        color: 0x16a34a,
      }],
      components: [],
      allowed_mentions: noMentions,
    };
  }
  const inactive = row.cancelled_at !== null || row.closed_at !== null || row.end_at <= nowSeconds();
  const status = row.cancelled_at !== null ? "This assignment changed or was cancelled. This check-in is closed."
    : inactive ? "This shift has ended."
    : `Your shift ${row.start_at > nowSeconds() ? `starts <t:${row.start_at}:R>` : "has started"}. Please confirm you’re ready.`;
  return {
    embeds: [{ title: "Chain watch check-in", description: `${shiftText(row)}\n\n${status}`, color: row.confirmed_at ? 0x16a34a : 0x2f80ed }],
    components: !inactive && row.confirmed_at === null ? [{ type: 1, components: [{
      type: 2, style: 3, label: "I’m ready", custom_id: `${WATCH_CHECK_IN_PREFIX}${row.id}`,
    }] }] : [],
    allowed_mentions: noMentions,
  };
}
function escalationPayload(row: CheckIn) {
  const resolved = row.confirmed_at !== null || row.cancelled_at !== null || row.closed_at !== null;
  const description = row.cancelled_at !== null ? "This assignment changed or was cancelled. The old check-in is closed."
    : row.confirmed_at !== null ? `✅ Resolved — the watcher checked in <t:${row.confirmed_at}:t>.`
    : row.closed_at !== null ? "The shift has ended."
    : row.escalation_kind === "delivery_failed" ? row.reminder_sent_at
      ? "The reminder has now been delivered; the watcher has not yet checked in. Please verify coverage."
      : "The check-in reminder could not be delivered. Please verify coverage."
    : "The scheduled watcher has not checked in. Cover may be needed.";
  const url = row.reminder_message_id ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.reminder_message_id}`
    : `https://discord.com/channels/${row.guild_id}/${row.channel_id}`;
  return { embeds: [{ title: row.escalation_kind === "delivery_failed" ? "Chain watch check-in delivery problem" : "Chain watch missed check-in",
    description: `${shiftText(row)}\n\n${description}\n[Open check-in channel](${url})`, color: resolved ? 0x64748b : 0xffa500 }],
    components: [], allowed_mentions: noMentions };
}

async function renderCheckIn(env: Env, row: CheckIn): Promise<void> {
  // Suppress mentions on edits; confirmed reminders also clear the original ping
  // so the message contains only the compact confirmation block.
  for (const [channel, message, payload] of [
    [row.channel_id, row.reminder_message_id, reminderPayload(row)],
    [row.escalation_channel_id, row.escalation_message_id, escalationPayload(row)],
  ] as const) {
    if (!channel || !message) continue;
    try { await patchDiscordBotJson(env.DISCORD_BOT_TOKEN!, `/channels/${channel}/messages/${message}`, payload, { timeoutMs: 10_000 }); }
    catch (error) { if (!(error instanceof ExternalApiError && error.status === 404)) throw error; }
  }
  // A concurrent confirmation increments dirty and must remain queued for rendering.
  await env.DB.prepare("UPDATE chain_watch_check_ins SET dirty = MAX(0, dirty - ?) WHERE id = ?").bind(row.dirty, row.id).run();
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

async function messageNonce(id: string, kind: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}:${kind}`)));
  return Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("");
}
function escapeText(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}
