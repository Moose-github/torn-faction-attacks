import { watchUtc } from "../shared/chainWatchSchedule";
import { CLEANUP_DELAY, TAKEOVER_LEAD, WATCH_CHECK_IN_PREFIX, WATCH_TAKE_OVER_PREFIX, reminderCleanupAt, type WatchCheckIn as CheckIn } from "./chainWatchCheckInModel";

const noMentions = { parse: [], users: [], roles: [] };

function shiftText(row: CheckIn): string {
  return `**${escapeText(row.watch_name)}**\nWatcher: ${escapeText(row.member_name)}\nShift: ${watchUtc(row.start_at)} – ${watchUtc(row.end_at)}`;
}
function cleanupLine(at: number | null): string {
  return at === null ? "" : `\nMessage cleanup: <t:${at}:R>`;
}

function watcherText(row: CheckIn): string {
  return row.taken_over_at !== null
    ? `~~${escapeText(row.member_name)}~~ → ${escapeText(row.taken_over_name!)}`
    : escapeText(row.member_name);
}
function shiftHours(row: CheckIn): string {
  const from = new Date((row.taken_over_start_at ?? row.start_at) * 1000).toISOString().slice(11, 16);
  const to = new Date((row.taken_over_end_at ?? row.end_at) * 1000).toISOString().slice(11, 16);
  return `${from} - ${to} UTC`;
}
export function reminderPayload(row: CheckIn, now: number) {
  if (row.taken_over_at !== null || (row.confirmed_at !== null && row.cancelled_at === null)) {
    return {
      content: "",
      embeds: [{
        description: `${escapeText(row.watch_name)} - **Chain watch check-in**\nWatcher: ${watcherText(row)} - Ready ✅\nShift: ${shiftHours(row)}${cleanupLine(reminderCleanupAt(row))}`,
        color: 0x16a34a,
      }],
      components: [],
      allowed_mentions: noMentions,
    };
  }
  const inactive = row.cancelled_at !== null || row.closed_at !== null || row.end_at <= now;
  const status = row.cancelled_at !== null ? "This assignment changed or was cancelled. This check-in is closed."
    : inactive ? "This shift has ended."
    : `Your shift ${row.start_at > now ? `starts <t:${row.start_at}:R>` : "has started"}. Please confirm you’re ready.`;
  return {
    embeds: [{ title: "Chain watch check-in", description: `${shiftText(row)}\n\n${status}${cleanupLine(reminderCleanupAt(row))}`, color: row.confirmed_at ? 0x16a34a : 0x2f80ed }],
    components: !inactive && row.confirmed_at === null ? [{ type: 1, components: [{
      type: 2, style: 3, label: "I’m ready", custom_id: `${WATCH_CHECK_IN_PREFIX}${row.id}`,
    }] }] : [],
    allowed_mentions: noMentions,
  };
}
export function escalationPayload(row: CheckIn, now: number) {
  const resolved = row.taken_over_at !== null || row.confirmed_at !== null || row.cancelled_at !== null || row.closed_at !== null;
  const description = row.taken_over_at !== null ? `✅ Resolved — shift taken over and checked in <t:${row.taken_over_at}:T>.`
    : row.cancelled_at !== null ? "This assignment changed or was cancelled. The old check-in is closed."
    : row.confirmed_at !== null ? `✅ Resolved — the watcher checked in <t:${row.confirmed_at}:T>.`
    : row.closed_at !== null ? "The shift has ended."
    : row.escalation_kind === "delivery_failed" ? row.reminder_sent_at
      ? "The reminder has now been delivered; the watcher has not yet checked in. Please verify coverage."
      : "The check-in reminder could not be delivered. Please verify coverage."
    : "The scheduled watcher has not checked in. Cover may be needed.";
  const url = row.reminder_message_id && row.reminder_deleted_at === null ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.reminder_message_id}`
    : `https://discord.com/channels/${row.guild_id}/${row.channel_id}`;
  const shift = row.escalation_kind === "delivery_failed" ? shiftText(row)
    : `Watcher: ${watcherText(row)}\nShift: ${shiftHours(row)}`;
  const title = row.taken_over_at !== null || (row.confirmed_at !== null && row.cancelled_at === null) ? "Chain watch - Resolved"
    : row.escalation_kind === "delivery_failed" ? "Chain watch check-in delivery problem" : "⚠️ Chain watch missed check-in";
  const canTakeOver = !resolved && row.escalation_kind === "missed" && row.end_at > now;
  const secondsUntilTakeover = Math.max(0, row.start_at - TAKEOVER_LEAD - now);
  const waiting = canTakeOver && secondsUntilTakeover > 0 ? `\nTakeover available in: ${secondsUntilTakeover}s` : "";
  return { embeds: [{ title,
    description: `${shift}\n\n${description}${waiting}\n[Open chain watch sheet](${url})${cleanupLine(row.cancelled_at === null ? null : row.cancelled_at + CLEANUP_DELAY)}`, color: resolved ? 0x64748b : 0xffa500 }],
    components: canTakeOver && secondsUntilTakeover === 0 ? [{ type: 1, components: [{
      type: 2, style: 1, label: "Take over", custom_id: `${WATCH_TAKE_OVER_PREFIX}${row.id}`,
    }] }] : [], allowed_mentions: noMentions };
}

export function escapeText(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}
