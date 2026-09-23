import { watchUtc } from "../shared/chainWatchSchedule";
import { ESCALATION_LEAD, TAKEOVER_LEAD, WATCH_CHECK_IN_PREFIX, WATCH_TAKE_OVER_PREFIX, reminderCleanupAt, type WatchCheckIn as CheckIn } from "./chainWatchCheckInModel";

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
  const missed = !inactive && now >= row.start_at - ESCALATION_LEAD;
  const canTakeOver = missed && row.reminder_sent_at !== null && now >= row.start_at - TAKEOVER_LEAD;
  const status = row.cancelled_at !== null ? "This assignment changed or was cancelled. This check-in is closed."
    : inactive ? "This shift has ended."
    : missed ? `The scheduled watcher has not checked in. Cover may be needed.\n${canTakeOver
      ? "Cover is now available. The assigned watcher can still confirm until someone takes over."
      : `Takeover available <t:${row.start_at - TAKEOVER_LEAD}:R>.`}`
    : `Your shift ${row.start_at > now ? `starts <t:${row.start_at}:R>` : "has started"}. Please confirm you’re ready.`;
  const buttons = [{ type: 2, style: 3, label: "I’m ready", custom_id: `${WATCH_CHECK_IN_PREFIX}${row.id}` }];
  if (canTakeOver) buttons.push({ type: 2, style: 1, label: "Take over", custom_id: `${WATCH_TAKE_OVER_PREFIX}${row.id}` });
  return {
    embeds: [{ title: missed ? "⚠️ Chain watch missed check-in" : "Chain watch check-in",
      description: `${shiftText(row)}\n\n${status}${cleanupLine(reminderCleanupAt(row))}`,
      color: inactive ? 0x64748b : missed ? 0xffa500 : 0x2f80ed }],
    components: !inactive && row.confirmed_at === null ? [{ type: 1, components: buttons }] : [],
    allowed_mentions: noMentions,
  };
}
export function escalationPayload(row: CheckIn, mentions = "") {
  const hasCard = row.reminder_message_id !== null && row.reminder_deleted_at === null;
  const url = hasCard ? `https://discord.com/channels/${row.guild_id}/${row.channel_id}/${row.reminder_message_id}`
    : `https://discord.com/channels/${row.guild_id}/${row.channel_id}`;
  const text = hasCard
    ? `⚠️ **${escapeText(row.member_name)}** hasn’t checked in for **${escapeText(row.watch_name)}** (${shiftHours(row)}).`
    : `⚠️ Chain watch check-in delivery problem: the reminder for **${escapeText(row.member_name)}** in **${escapeText(row.watch_name)}** (${shiftHours(row)}) ${row.reminder_sent_at === null ? "could not be delivered" : "is no longer available"}. Please verify coverage.`;
  return { content: `${mentions ? `${mentions}\n` : ""}${text} [${hasCard ? "Open check-in" : "Open watch channel"}](<${url}>)`,
    embeds: [], components: [], allowed_mentions: noMentions };
}

export function escapeText(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}
