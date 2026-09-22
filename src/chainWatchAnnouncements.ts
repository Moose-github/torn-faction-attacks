import type { ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { DEFAULT_WATCH_PAYMENT_PER_SHIFT, summarizeWatchers } from "../shared/chainWatchSummary";
import { readWatch } from "./chainWatchSchedule";
import { watchPageUrl } from "./chainWatchScheduleDiscord";
import { deleteWatchDiscordMessage, editWatchDiscordMessage, sendWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export const WATCH_INFO_TEXT = [
  "• Maximum 2 shifts in a row.",
  `• Each hour pays $${DEFAULT_WATCH_PAYMENT_PER_SHIFT.toLocaleString("en-US")} after the watch finishes.`,
  "• You'll be pinged 3 minutes before your shift starts to confirm you're ready. If you haven't checked in, an alert is sent 1 minute before the start, and another player can take over from 30 seconds before the start.",
  "• You must have energy available to make hits during your shifts.",
  "• You can watch while abroad, as long as you fly out with plenty of energy to make hits.",
  "• You cannot watch if you have bounties on you.",
  "• Make a hit when the timer has 1–2 minutes remaining.",
  "• Finish your shift with a full 5 minutes left on the timer.",
].join("\n\n");

function escapeText(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}

function announcementPayload(env: Env, data: ChainWatchScheduleResponse, title: string, description: string, footer?: string) {
  return {
    content: "",
    embeds: [{ title, description, color: 0x2f80ed, ...(footer ? { footer: { text: footer } } : {}) }],
    allowed_mentions: { parse: [], users: [], roles: [] },
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open page", url: watchPageUrl(env, data.watch!.id) }] }],
  };
}

export function watchInfoPayload(env: Env, data: ChainWatchScheduleResponse) {
  return { ...announcementPayload(env, data, data.watch!.name, WATCH_INFO_TEXT), components: [] };
}

export function watchSummaryPayloads(env: Env, data: ChainWatchScheduleResponse) {
  const watchers = summarizeWatchers(data.slots, data.now);
  const heading = `Payment: $${DEFAULT_WATCH_PAYMENT_PER_SHIFT.toLocaleString("en-US")} per completed assigned hourly shift.\nCancelled and unfilled slots are excluded.\n\n`;
  const pages: string[] = [];
  let description = heading;
  for (const watcher of watchers) {
    const line = `**${escapeText(watcher.name.slice(0, 100))}**\nShifts: ${watcher.count} · Payment: $${watcher.payment.toLocaleString("en-US")}\n\n`;
    if (description.length + line.length > 3900) { pages.push(description.trimEnd()); description = heading; }
    description += line;
  }
  if (!watchers.length) description += "No completed watches were assigned.";
  pages.push(description.trimEnd());
  return pages.map((page, index) => announcementPayload(env, data, `${data.watch!.name} — Watch summary`, page,
    pages.length > 1 ? `Page ${index + 1} of ${pages.length}` : undefined));
}

type Announcement = { payloads_json: string | null; message_ids_json: string; sent_at: number | null };
type Summary = Announcement & { revision: number; published_revision: number; payload_revision: number | null; next_page: number };

// Intro messages are immutable; persist the payload and ID for delivery retries.
async function deliverAnnouncement(env: Env, data: ChainWatchScheduleResponse, kind: "intro", now: number, stopAt: number): Promise<boolean> {
  if (!env.DISCORD_BOT_TOKEN || !data.watch || data.watch.guild_id !== env.DISCORD_GUILD_ID) return false;
  const watch = data.watch;
  const token = crypto.randomUUID();
  const lease = await env.DB.prepare(`UPDATE chain_watch_announcements SET sync_token = ?, sync_until = ?
    WHERE watch_id = ? AND kind = ? AND sent_at IS NULL AND sync_until <= ?`)
    .bind(token, now + 120, watch.id, kind, now).run();
  if (!lease.meta.changes) {
    const state = await env.DB.prepare("SELECT sent_at FROM chain_watch_announcements WHERE watch_id = ? AND kind = ?")
      .bind(watch.id, kind).first<{ sent_at: number | null }>();
    return state?.sent_at != null;
  }
  try {
    const row = (await env.DB.prepare("SELECT payloads_json, message_ids_json, sent_at FROM chain_watch_announcements WHERE watch_id = ? AND kind = ?")
      .bind(watch.id, kind).first<Announcement>())!;
    const payloads: ReturnType<typeof announcementPayload>[] = row.payloads_json ? JSON.parse(row.payloads_json)
      : [watchInfoPayload(env, data)];
    if (!row.payloads_json) await env.DB.prepare(`UPDATE chain_watch_announcements SET payloads_json = ? WHERE watch_id = ? AND kind = ? AND sync_token = ?`)
      .bind(JSON.stringify(payloads), watch.id, kind, token).run();
    const ids: string[] = JSON.parse(row.message_ids_json);
    while (ids.length < payloads.length) {
      if (Date.now() >= stopAt) return false;
      const delivery = await sendWatchDiscordMessage(env, watch.channel_id, payloads[ids.length], `watch:${watch.id}:${kind}:${ids.length}`);
      if (delivery.status === "failed") throw delivery.error;
      ids.push(delivery.value);
      await env.DB.prepare(`UPDATE chain_watch_announcements SET message_ids_json = ?, sent_at = ?
        WHERE watch_id = ? AND kind = ? AND sync_token = ?`)
        .bind(JSON.stringify(ids), ids.length === payloads.length ? now : null, watch.id, kind, token).run();
    }
    return true;
  } finally {
    await env.DB.prepare(`UPDATE chain_watch_announcements SET sync_token = NULL, sync_until = 0
      WHERE watch_id = ? AND kind = ? AND sync_token = ?`).bind(watch.id, kind, token).run();
  }
}

export function ensureWatchInfo(env: Env, data: ChainWatchScheduleResponse, now = nowSeconds(), stopAt = Date.now() + 15_000) {
  return deliverAnnouncement(env, data, "intro", now, stopAt);
}

async function deliverWatchSummary(env: Env, watchId: string, now: number, stopAt: number): Promise<void> {
  const token = crypto.randomUUID();
  const lease = await env.DB.prepare(`UPDATE chain_watch_announcements SET sync_token = ?, sync_until = ?
    WHERE watch_id = ? AND kind = 'summary' AND published_revision < revision AND sync_until <= ?`)
    .bind(token, now + 120, watchId, now).run();
  if (!lease.meta.changes) return;
  try {
    const row = (await env.DB.prepare("SELECT * FROM chain_watch_announcements WHERE watch_id = ? AND kind = 'summary'")
      .bind(watchId).first<Summary>())!;
    const revision = row.revision;
    // Read totals after capturing their revision. The conditional snapshot write
    // rejects any correction which lands while the schedule is being read.
    const data = await readWatch(env, watchId);
    data.now = now;
    if (!data.watch || data.watch.guild_id !== env.DISCORD_GUILD_ID ||
        (data.watch.is_open && (data.watch.finish_at === null || data.watch.finish_at > now))) return;
    const channel = data.watch.channel_id;
    let payloads: ReturnType<typeof watchSummaryPayloads> = row.payloads_json ? JSON.parse(row.payloads_json) : [];
    let nextPage = row.next_page;
    const ids: string[] = JSON.parse(row.message_ids_json);
    if (row.payload_revision !== revision || !row.payloads_json) {
      payloads = watchSummaryPayloads(env, data);
      const serialized = JSON.stringify(payloads);
      // An edit followed by its reversal (or migration of an unchanged summary)
      // needs no Discord request if the last complete publication still matches.
      if (row.published_revision === row.payload_revision && serialized === row.payloads_json) {
        await env.DB.prepare(`UPDATE chain_watch_announcements SET published_revision = ?, payload_revision = ?
          WHERE watch_id = ? AND kind = 'summary' AND sync_token = ? AND revision = ?`)
          .bind(revision, revision, watchId, token, revision).run();
        return;
      }
      const saved = await env.DB.prepare(`UPDATE chain_watch_announcements SET payloads_json = ?, payload_revision = ?, next_page = 0
        WHERE watch_id = ? AND kind = 'summary' AND sync_token = ? AND revision = ?`)
        .bind(serialized, revision, watchId, token, revision).run();
      if (!saved.meta.changes) return;
      nextPage = 0;
    }
    const stillCurrent = async () => Date.now() < stopAt && Boolean(await env.DB.prepare(`SELECT 1 FROM chain_watch_announcements
      WHERE watch_id = ? AND kind = 'summary' AND sync_token = ? AND revision = ?`)
      .bind(watchId, token, revision).first());
    for (; nextPage < payloads.length; nextPage++) {
      if (!await stillCurrent()) return;
      let id: string | null = ids[nextPage] ?? null;
      if (id) {
        const edited = await editWatchDiscordMessage(env, channel, id, payloads[nextPage]);
        if (edited.status === "failed") throw edited.error;
        if (edited.status === "skipped") id = null;
      }
      if (!id) {
        // Keep the legacy nonce for revision zero, including pending deliveries
        // spanning deployment. Later revisions may add or recreate a page.
        const nonceKey = `watch:${watchId}:summary:${nextPage}${revision ? `:${revision}` : ""}`;
        const sent = await sendWatchDiscordMessage(env, channel, payloads[nextPage], nonceKey);
        if (sent.status === "failed") throw sent.error;
        id = sent.value;
      }
      ids[nextPage] = id;
      // Retain returned IDs even if a correction arrived during HTTP. The next
      // revision edits these messages instead of posting duplicate pages.
      await env.DB.prepare(`UPDATE chain_watch_announcements SET message_ids_json = ?, next_page = ?
        WHERE watch_id = ? AND kind = 'summary' AND sync_token = ?`)
        .bind(JSON.stringify(ids), nextPage + 1, watchId, token).run();
    }
    while (ids.length > payloads.length) {
      if (!await stillCurrent()) return;
      const deleted = await deleteWatchDiscordMessage(env, channel, ids.at(-1)!);
      if (deleted.status === "failed") throw deleted.error;
      ids.pop();
      await env.DB.prepare(`UPDATE chain_watch_announcements SET message_ids_json = ?
        WHERE watch_id = ? AND kind = 'summary' AND sync_token = ?`).bind(JSON.stringify(ids), watchId, token).run();
    }
    await env.DB.prepare(`UPDATE chain_watch_announcements SET published_revision = ?, sent_at = COALESCE(sent_at, ?)
      WHERE watch_id = ? AND kind = 'summary' AND sync_token = ? AND revision = ?`)
      .bind(revision, now, watchId, token, revision).run();
  } finally {
    await env.DB.prepare(`UPDATE chain_watch_announcements SET sync_token = NULL, sync_until = 0
      WHERE watch_id = ? AND kind = 'summary' AND sync_token = ?`).bind(watchId, token).run();
  }
}

export async function publishFinishedWatchSummaries(env: Env, now = nowSeconds(), stopAt = Date.now() + 15_000): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) return;
  const due = await env.DB.prepare(`SELECT w.id FROM chain_watch_schedules w JOIN chain_watch_announcements a ON a.watch_id = w.id
    WHERE a.kind = 'summary' AND a.published_revision < a.revision AND a.sync_until <= ? AND w.guild_id = ?
      AND (w.is_open = 0 OR w.finish_at <= ?) ORDER BY w.finish_at, w.created_at LIMIT 10`)
    .bind(now, env.DISCORD_GUILD_ID, now).all<{ id: string }>();
  const errors: unknown[] = [];
  for (const row of due.results) {
    if (Date.now() >= stopAt) break;
    try {
      const data = await readWatch(env, row.id);
      data.now = now;
      // Recheck the schedule after the query in case an admin extended it.
      if (!data.watch || (data.watch.is_open && (data.watch.finish_at === null || data.watch.finish_at > now))) continue;
      if (!await ensureWatchInfo(env, data, now, stopAt)) continue;
      await deliverWatchSummary(env, row.id, now, stopAt);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw errors[0];
}
