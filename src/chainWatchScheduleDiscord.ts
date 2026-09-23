import { createsLongWatchRun, nextWatchHour, watchDate, watchUtc, watchSlotStatus, WATCH_DAY, WATCH_HOUR, type ChainWatchSheet, type ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, currentWatch, parseWatchTime, readWatch, reconcileWatch, setWatchFinish, WatchError, watchDiscordMember } from "./chainWatchSchedule";
import { CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING } from "./discordCommands";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { readDiscordAlertMentions } from "./discordMentions";
import { discordNotificationChannelTargetId, readConfiguredDiscordNotificationChannel, readDiscordNotificationGuildId } from "./discordNotificationChannels";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { assertExternalResponseOk, ExternalApiError, fetchExternal, readExternalJson } from "./external/http";
import type { Env } from "./types";
import { nowSeconds } from "./utils";
import type { WatchSelectionContext } from "./chainWatchPrivateSession";
import { ensureWatchInfo, publishFinishedWatchSummaries } from "./chainWatchAnnouncements";
import { deleteWatchDiscordMessage, editWatchDiscordMessage, sendWatchDiscordMessage } from "./chainWatchDiscordDelivery";
import { confirmWatchCheckIn, handleWatchTakeover, isWatchCheckInInteraction, isWatchTakeoverConfirmation, isWatchTakeoverInteraction, runWatchCheckIns } from "./chainWatchCheckIns";
import { cleanupWatchUnfilledSlotAlerts } from "./chainWatchUnfilledAlertCleanup";

export const WATCH_COMPONENT_PREFIX = "cws:";
export const WATCH_UNFILLED_SLOT_LEAD_SECONDS = WATCH_HOUR;

export function canManageWatchOnDiscord(permissions: string | undefined, publicTesting: boolean = CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING): boolean {
  if (publicTesting) return true;
  try { return (BigInt(permissions ?? "0") & 8n) === 8n; } catch { return false; }
}

export function isWatchInteraction(interaction: DiscordInteraction): boolean {
  return ((interaction.type === 2 || interaction.type === 4) && interaction.data?.name === "chain-watch") ||
    (interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_COMPONENT_PREFIX)));
}

function updatesWatchMessage(interaction: DiscordInteraction): boolean {
  return isWatchTakeoverConfirmation(interaction) || (interaction.type === 3 && /^(cws:pick:|cws:confirm:)/.test(interaction.data?.custom_id ?? ""));
}

export function deferredWatchResponse(interaction: DiscordInteraction): DiscordInteractionResponse {
  return isWatchCheckInInteraction(interaction) || updatesWatchMessage(interaction) ? { type: 6 } : { type: 5, data: { flags: 64 } };
}

function watchTimeChoice(timestamp: number, now: number): { name: string; value: string } {
  const value = watchUtc(timestamp).replace(" UTC", "");
  const daysAway = Math.floor(timestamp / WATCH_DAY) - Math.floor(now / WATCH_DAY);
  const day = daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : watchDate(timestamp);
  const time = new Date(timestamp * 1000).toISOString().slice(11, 16);
  return { name: `${time} UTC — ${day}`, value };
}

function watchAutocompleteResponse(interaction: DiscordInteraction, env: Env, now = nowSeconds()): DiscordInteractionResponse {
  const empty: DiscordInteractionResponse = { type: 8, data: { choices: [] } };
  if (!env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID || !interaction.member?.user?.id ||
    !canManageWatchOnDiscord(interaction.member.permissions)) return empty;
  const command = interaction.data?.options?.[0];
  const focused = command?.options?.find((option) => option.focused);
  if (!focused || (focused.value !== undefined && typeof focused.value !== "string")) return empty;
  if (command?.name !== "create" && command?.name !== "setfinish") return empty;
  if (focused.name !== "finish" && !(command.name === "create" && focused.name === "start")) return empty;

  let after = now;
  if (command?.name === "create" && focused.name === "finish") {
    try {
      after = parseWatchTime(command.options?.find((option) => option.name === "start")?.value, nextWatchHour(now), now);
      if (after <= now) return empty;
    } catch { return empty; }
  }

  const query = String(focused.value ?? "").trim();
  const ongoing = { name: "No finish — continue daily sheets", value: "ongoing" };
  const ongoingChoices = command.name === "setfinish" && (!query ||
    ongoing.value.startsWith(query.toLowerCase()) || ongoing.name.toLowerCase().includes(query.toLowerCase())) ? [ongoing] : [];
  // A complete date remains usable for a watch scheduled beyond the next day.
  if (/^(?:\d{2}|\d{4})-/.test(query)) {
    try {
      const timestamp = parseWatchTime(query, undefined, after);
      return { type: 8, data: { choices: timestamp > after ? [watchTimeChoice(timestamp, now)] : [] } };
    } catch { /* Partial dates can still filter the upcoming choices below. */ }
  }
  const dateQuery = /^(?:\d{2}-|\d{4}(?:-|$))/.test(query);
  const choices = Array.from({ length: 24 }, (_, index) => nextWatchHour(after) + index * WATCH_HOUR)
    .filter((timestamp) => {
      if (!query) return true;
      const iso = new Date(timestamp * 1000).toISOString();
      if (dateQuery) return watchUtc(timestamp).startsWith(query.replace("T", " ")) || iso.replace("T", " ").startsWith(query.replace("T", " "));
      const time = iso.slice(11, 16);
      return time.startsWith(query) || time.replace(/^0/, "").startsWith(query);
    })
    .map((timestamp) => watchTimeChoice(timestamp, now));
  return { type: 8, data: { choices: [...ongoingChoices, ...choices] } };
}

function escaped(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}

function watchSlotLabel(start: number): string {
  const from = new Date(start * 1000).toISOString().slice(11, 16);
  const end = start + WATCH_HOUR;
  const to = end % WATCH_DAY === 0 ? "24:00" : new Date(end * 1000).toISOString().slice(11, 16);
  return `${from} - ${to}`;
}

export function watchPageUrl(env: Env, watchId: string): string {
  return `${(env.DASHBOARD_BASE_URL ?? "https://buttgrass.pages.dev").replace(/\/$/, "")}/chain-watch?watch=${encodeURIComponent(watchId)}`;
}

export async function watchDiscordRequest<T>(env: Env, path: string, method: string, body: unknown, webhook = false): Promise<T> {
  if (!webhook && !env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured");
  const response = await fetchExternal(`https://discord.com/api/v10${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(!webhook ? { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } : {}) },
    body: JSON.stringify(body),
  }, { timeoutMs: 10_000 });
  const data = await readExternalJson<T>(response);
  await assertExternalResponseOk(response, "Discord chain watch", data);
  return data;
}

// Acknowledge first: creating a schedule or editing several Discord messages can
// exceed Discord's three-second interaction deadline.
export async function completeDeferredWatchInteraction(interaction: DiscordInteraction, env: Env): Promise<void> {
  if (interaction.type === 3 && !isWatchCheckInInteraction(interaction) && !isWatchTakeoverInteraction(interaction)) {
    // A single durable coordinator per Discord user orders both state changes
    // and outgoing Discord requests across Worker instances.
    const userId = interaction.member?.user?.id;
    if (!userId) return;
    const stub = env.CHAIN_WATCH_SESSIONS.get(env.CHAIN_WATCH_SESSIONS.idFromName(userId));
    const response = await stub.fetch("https://watch-session/interaction", { method: "POST", body: JSON.stringify(interaction) });
    if (!response.ok) throw new Error("Unable to complete chain watch session");
    await syncWatchBoardsSafely(env);
    return;
  }
  const response = await handleWatchInteraction(interaction, env);
  try {
    if (isWatchCheckInInteraction(interaction)) {
      // Successful check-ins update the public reminder. Errors need a private
      // follow-up because @original now refers to that public reminder.
      if (response.type === 4 && response.data) {
        await watchDiscordRequest(env, `/webhooks/${interaction.application_id}/${interaction.token}`, "POST", response.data, true);
      }
    } else {
      const { flags: _flags, ...data } = response.data ?? {};
      await watchDiscordRequest(env, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, "PATCH", data, true);
    }
  } catch (error) {
    console.error("Unable to complete chain watch reply", error instanceof ExternalApiError ? error.status : "transport error");
  }
  await syncWatchBoardsSafely(env);
}

export async function handleWatchInteraction(interaction: DiscordInteraction, env: Env, session?: WatchSelectionContext): Promise<DiscordInteractionResponse> {
  if (interaction.type === 4) return watchAutocompleteResponse(interaction, env);
  const update = updatesWatchMessage(interaction);
  const reply = (content: string, components: NonNullable<DiscordInteractionResponse["data"]>["components"] = []): DiscordInteractionResponse => ({
    type: update ? 7 : 4,
    data: { content, components, ...(!update ? { flags: 64 } : {}), allowed_mentions: { parse: [] } },
  });
  try {
    if (isWatchCheckInInteraction(interaction)) return await confirmWatchCheckIn(interaction, env);
    if (isWatchTakeoverInteraction(interaction)) return await handleWatchTakeover(interaction, env);
    const guildId = interaction.guild_id;
    const userId = interaction.member?.user?.id;
    if (!guildId || !userId || !env.DISCORD_GUILD_ID || guildId !== env.DISCORD_GUILD_ID) {
      throw new WatchError("Use chain watch in the faction Discord server.", 403);
    }
    if (interaction.type === 2) {
      if (!canManageWatchOnDiscord(interaction.member?.permissions)) throw new WatchError("Only server administrators can manage the watch.", 403);
      const command = interaction.data?.options?.[0];
      const option = (name: string) => command?.options?.find((item) => item.name === name)?.value;
      if (command?.name === "create") {
        if (!interaction.channel_id) throw new WatchError("Choose a server channel for the sheet.");
        const watch = await createWatch(env, {
          name: option("name"), start: option("start"), finish: option("finish"), guildId,
          channelId: interaction.channel_id, discordUserId: userId,
        });
        return reply(`Created **${escaped(watch.name)}**.\nStart: ${watchUtc(watch.start_at)}\nFinish: ${watch.finish_at === null ? "Not set; daily UTC sheets" : watchUtc(watch.finish_at)}\nThe roster will appear in this channel.`, [{ type: 1, components: [{ type: 2, style: 5, label: "Open page", url: watchPageUrl(env, watch.id) }] }]);
      }
      if (command?.name === "setfinish") {
        const requestedFinish = option("finish");
        if (typeof requestedFinish !== "string" || !requestedFinish.trim()) throw new WatchError("Choose a finish time or ongoing to continue daily sheets.");
        const watch = await currentWatch(env);
        if (!watch || watch.guild_id !== guildId) throw new WatchError("There is no unfinished watch.");
        const finish = await setWatchFinish(env, watch.id, requestedFinish);
        if (finish === null) return reply(`**${escaped(watch.name)}** now has no finish time. Daily sheets will continue, with the next day published at 12:00 UTC. Active assignments are preserved; reopened slots are available for new sign-ups.`);
        return reply(`**${escaped(watch.name)}** will finish at ${watchUtc(finish)}. Slots starting then or later are cancelled; earlier assignments are preserved.`);
      }
      throw new WatchError("Use /chain-watch create or /chain-watch setfinish.");
    }

    const actorId = await watchDiscordMember(env, userId);
    const parts = (interaction.data?.custom_id ?? "").split(":");
    // Component actions are only valid inside the per-user coordinator. Legacy
    // private controls cannot bypass its message and selection checks.
    if (!session || session.userId !== userId || session.guildId !== guildId) throw new WatchError("This message expired. Open Sign up or Leave slots again.");
    if (parts[1] === "confirm") {
      if (parts[2] !== session.id || !session.selectionId || parts[3] !== session.selectionId) throw new WatchError("Your selection changed. Use the latest confirmation.");
      const selection = await env.DB.prepare(`SELECT * FROM chain_watch_pending_selections
        WHERE id = ? AND discord_user_id = ? AND guild_id = ? AND expires_at > ?`)
        .bind(session.selectionId, userId, guildId, nowSeconds())
        .first<{ id: string; watch_id: string; action: "claim" | "leave"; starts_json: string }>();
      if (!selection) throw new WatchError("This selection expired or was already used. Open Sign up or Leave slots again.");
      const data = await readWatch(env, selection.watch_id);
      if (data.watch?.guild_id !== guildId) throw new WatchError("This watch belongs to another server.", 403);
      const starts: number[] = JSON.parse(selection.starts_json);
      await changeWatchSlots(env, { watchId: selection.watch_id, starts, actorId, targetId: selection.action === "claim" ? actorId : null, admin: false, selectionId: selection.id });
      return reply(`${selection.action === "claim" ? "Signed up for" : "Left"} ${starts.length} slot${starts.length === 1 ? "" : "s"}. The shared roster is updating.`);
    }

    const { action, sheetId } = session;
    if (!["open", "pick"].includes(parts[1]) || !["claim", "leave"].includes(action)) throw new WatchError("Open the current sheet to continue.");
    const sheet = await env.DB.prepare("SELECT * FROM chain_watch_sheets WHERE id = ?").bind(sheetId).first<ChainWatchSheet>();
    if (!sheet) throw new WatchError("Sheet not found.");
    const data = await readWatch(env, sheet.watch_id);
    if (data.watch?.guild_id !== guildId) throw new WatchError("This watch belongs to another server.", 403);
    const mine = data.slots.filter((slot) => !slot.cancelled && slot.assigned_to === actorId).map((slot) => slot.start_at);
    const available = data.slots.filter((slot) => slot.sheet_id === sheetId && !slot.cancelled && slot.start_at > data.now &&
      (action === "leave" ? slot.assigned_to === actorId : slot.assigned_to === null && !createsLongWatchRun(mine, slot.start_at)));

    const sheetDate = watchDate(sheet.start_at);
    if (!available.length) return reply(action === "leave" ? `You have no future assignments on **${sheetDate}** (UTC).` : `There are no available slots you can take on **${sheetDate}** (UTC).`);
    const selectionMessage = (starts: number[] = [], selectionId?: string, error?: string) => reply(
      `${action === "claim" ? "Choose slots to claim" : "Choose your slots to leave"} for **${sheetDate}** (UTC).\n${error ?? "Press Confirm when ready."}${starts.length ? `\n\nSelected:\n${starts.map(watchSlotLabel).join("\n")}` : ""}`,
      [{ type: 1, components: [{
        type: 3, custom_id: `cws:pick:${session.id}`, placeholder: "Choose hourly slots", min_values: 1, max_values: available.length,
        options: available.map((slot) => ({ label: watchSlotLabel(slot.start_at), value: String(slot.start_at), default: starts.includes(slot.start_at) })),
      }] }, { type: 1, components: [{
        type: 2, style: action === "claim" ? 3 : 4, label: action === "claim" ? "Confirm sign-up" : "Confirm leave",
        custom_id: `cws:confirm:${session.id}:${selectionId ?? "empty"}`, disabled: !selectionId,
      }] }],
    );

    if (parts[1] === "open") return selectionMessage();

    const selected = interaction.data?.values ?? [];
    if (!selected.length || selected.length > 24 || selected.some((value) => !/^\d+$/.test(value))) return selectionMessage([], undefined, "Choose valid slots.");
    const starts = [...new Set(selected.map(Number))];
    if (starts.some((start) => !available.some((slot) => slot.start_at === start))) return selectionMessage([], undefined, "A selected slot is no longer available. Choose your slots again.");
    if (action === "claim") {
      const finalHours = new Set([...mine, ...starts]);
      if (starts.some((start) => createsLongWatchRun(finalHours, start))) return selectionMessage(starts, undefined, "Your selection needs at least one hour off after two consecutive slots. Adjust your selection to continue.");
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO chain_watch_pending_selections(id, discord_user_id, guild_id, watch_id, action, starts_json, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, guildId, sheet.watch_id, action, JSON.stringify(starts), nowSeconds() + 10 * 60).run();
    session.selectionId = id;
    return selectionMessage(starts, id);
  } catch (error) {
    if (error instanceof WatchError) return reply(error.message);
    console.error("Chain watch interaction failed", error instanceof Error ? error.message : "Unknown error");
    return reply("Chain watch is temporarily unavailable. Try again shortly.");
  }
}

export function watchBoardPayload(env: Env, data: ChainWatchScheduleResponse, sheet: ChainWatchSheet) {
  const watch = data.watch!;
  const slots = data.slots.filter((slot) => slot.sheet_id === sheet.id && !slot.cancelled);
  const future = slots.some((slot) => slot.start_at > data.now);
  const newestSheet = slots.length > 0 && data.sheets.every((candidate) => candidate.start_at <= sheet.start_at ||
    !data.slots.some((slot) => slot.sheet_id === candidate.id && !slot.cancelled));
  const footerText = watch.finish_at ? `Watch finishes ${watchUtc(watch.finish_at)}` :
    watch.is_open && newestSheet ? "Next day published at 12:00 UTC" : "";
  const filled = `${slots.filter((slot) => slot.assigned_to).length}/${slots.length} filled`;
  const rows = slots.map((slot) => {
    const status = watchSlotStatus(slot, data.now);
    const who = slot.assigned_to ? escaped((slot.member_name ?? `Player ${slot.assigned_to}`).slice(0, 32)) : status.current ? "Unfilled" : null;
    return `${status.icon ? `${status.icon} ` : ""}**${watchSlotLabel(slot.start_at)}**${who ? ` · ${who}` : ""} · ${status.label}`;
  });
  return {
    content: "",
    embeds: [{
      color: 0x2f80ed,
      description: `### ${escaped(watch.name)} · ${watchDate(sheet.start_at)} (UTC)\n${filled}\n\n${rows.join("\n")}`,
      ...(footerText ? { footer: { text: footerText } } : {}),
    }],
    allowed_mentions: { parse: [] },
    components: future ? [{ type: 1, components: [
      { type: 2, style: 3, label: "Sign up", custom_id: `cws:open:claim:${sheet.id}` },
      { type: 2, style: 2, label: "Leave slots", custom_id: `cws:open:leave:${sheet.id}` },
      { type: 2, style: 5, label: "Open page", url: watchPageUrl(env, watch.id) },
    ] }] : [],
  };
}

export async function syncWatchBoardsSafely(env: Env): Promise<void> {
  // Both Discord and website assignment changes call this immediately after
  // saving. Cleanup failures must not undo the assignment or block the roster.
  try { await cleanupWatchUnfilledSlotAlerts(env); } catch (error) { console.error("Chain watch unfilled alert cleanup will retry", error instanceof Error ? error.message : "Unknown error"); }
  try { await syncWatchBoards(env); } catch (error) { console.error("Chain watch roster sync will retry", error instanceof Error ? error.message : "Unknown error"); }
}

export async function syncWatchBoards(env: Env, now = nowSeconds()): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) return;
  const stopAt = Date.now() + 15_000;
  const errors: unknown[] = [];
  const hour = Math.floor(now / WATCH_HOUR);
  // Keep the final render due until it succeeds, however long sync is delayed.
  // Once rendered at or after expiry, a clean sheet needs no more hourly refreshes.
  const rows = await env.DB.prepare(`SELECT id FROM chain_watch_sheets WHERE dirty > 0
    OR (start_at <= ? AND render_hour < MIN(?, CAST(end_at / ${WATCH_HOUR} AS INTEGER)))
    ORDER BY start_at LIMIT 30`).bind(now, hour).all<{ id: string }>();
  for (const row of rows.results) {
    if (Date.now() >= stopAt) break;
    const token = crypto.randomUUID();
    const lease = await env.DB.prepare("UPDATE chain_watch_sheets SET sync_token = ?, sync_until = ? WHERE id = ? AND sync_until <= ?").bind(token, now + 60, row.id, now).run();
    if (!lease.meta.changes) continue;
    try {
      const sheet = (await env.DB.prepare("SELECT * FROM chain_watch_sheets WHERE id = ?").bind(row.id).first<ChainWatchSheet & { dirty: number; last_payload: string | null }>())!;
      const data = await readWatch(env, sheet.watch_id);
      if (data.slots.filter((slot) => slot.sheet_id === sheet.id).every((slot) => slot.cancelled)) {
        if (sheet.discord_message_id) {
          const delivery = await deleteWatchDiscordMessage(env, data.watch!.channel_id, sheet.discord_message_id);
          if (delivery.status === "failed") throw delivery.error;
        }
        // Only the Discord publication metadata changes. Keep cancelled slots,
        // assignments and sheet records for the page and historical data.
        // Clear the ID after deletion succeeds so failures retry the same message.
        await env.DB.prepare(`UPDATE chain_watch_sheets SET discord_message_id = NULL, last_payload = NULL,
          dirty = MAX(0, dirty - ?), render_hour = ? WHERE id = ? AND sync_token = ?`)
          .bind(sheet.dirty, hour, row.id, token).run();
        continue;
      }
      if (!await ensureWatchInfo(env, data, now, stopAt)) continue;
      const payload = watchBoardPayload(env, data, sheet);
      const serialized = JSON.stringify(payload);
      let messageId = sheet.discord_message_id;
      if (messageId && sheet.last_payload !== serialized) {
        const delivery = await editWatchDiscordMessage(env, data.watch!.channel_id, messageId, payload);
        if (delivery.status === "failed") throw delivery.error;
        if (delivery.status === "skipped") messageId = null;
      }
      if (!messageId) {
        const delivery = await sendWatchDiscordMessage(env, data.watch!.channel_id, payload, sheet.id);
        if (delivery.status === "failed") throw delivery.error;
        messageId = delivery.value;
      }
      await env.DB.prepare(`UPDATE chain_watch_sheets SET discord_message_id = ?, last_payload = ?, render_hour = ?, dirty = MAX(0, dirty - ?)
        WHERE id = ? AND sync_token = ?`).bind(messageId, serialized, hour, sheet.dirty, row.id, token).run();
    } catch (error) {
      errors.push(error);
    } finally {
      await env.DB.prepare("UPDATE chain_watch_sheets SET sync_token = NULL, sync_until = 0 WHERE id = ? AND sync_token = ?").bind(row.id, token).run();
    }
  }
  try { await publishFinishedWatchSummaries(env, now, stopAt); }
  catch (error) { errors.push(error); }
  if (errors.length) throw errors[0];
}

export async function runWatchUnfilledSlotAlerts(env: Env, now = nowSeconds()): Promise<void> {
  try { await sendWatchUnfilledSlotAlerts(env, now); }
  // Recheck after HTTP: a slot may have been filled while its alert was sent.
  // Also clean up when new alerts are disabled, unrouted, or fail to send.
  finally { await cleanupWatchUnfilledSlotAlerts(env, now); }
}

async function sendWatchUnfilledSlotAlerts(env: Env, now: number): Promise<void> {
  const guildId = readDiscordNotificationGuildId(env);
  if (!env.DISCORD_BOT_TOKEN || !guildId) return;
  const checkedAt = Math.max(now, nowSeconds());
  const rows = await env.DB.prepare(`SELECT s.watch_id, s.start_at, w.name, w.channel_id, sheet.discord_message_id
    FROM chain_watch_slots s JOIN chain_watch_schedules w ON w.id = s.watch_id
    JOIN chain_watch_sheets sheet ON sheet.id = s.sheet_id AND sheet.watch_id = s.watch_id
    WHERE s.cancelled = 0 AND s.assigned_to IS NULL AND s.unfilled_alert_sent_at IS NULL
      AND s.unfilled_alert_until <= ? AND s.start_at > ? AND s.start_at <= ?
      AND w.is_open = 1 AND w.guild_id = ? AND s.start_at >= w.start_at
      AND (w.finish_at IS NULL OR s.start_at < w.finish_at)
    ORDER BY s.start_at`).bind(checkedAt, checkedAt, checkedAt + WATCH_UNFILLED_SLOT_LEAD_SECONDS, guildId)
    .all<{ watch_id: string; start_at: number; name: string; channel_id: string; discord_message_id: string | null }>();
  const alertKey = DISCORD_ALERT_KEYS.chainWatchUnfilledSlot;
  if (!rows.results.length || !await isDiscordAlertEnabled(env, alertKey)) return;
  const route = await readConfiguredDiscordNotificationChannel(env, alertKey);
  if (!route) return;
  const mentions = await readDiscordAlertMentions(env, alertKey);
  for (const slot of rows.results) {
    const channelUrl = `https://discord.com/channels/${guildId}/${slot.channel_id}`;
    const signUpLink = slot.discord_message_id
      ? `[Open chain watch sheet](${channelUrl}/${slot.discord_message_id})`
      : `[Open chain watch channel](${channelUrl})`;
    // The durable marker and lease prevent repeats across ticks and overlapping workers.
    // A stable Discord nonce also covers retries after an ambiguous POST response.
    const token = crypto.randomUUID();
    const sendAt = Math.max(checkedAt, nowSeconds());
    // Recheck assignment, cancellation, finish and time after the async settings reads.
    const lease = await env.DB.prepare(`UPDATE chain_watch_slots SET unfilled_alert_token = ?, unfilled_alert_until = ?
      WHERE watch_id = ? AND start_at = ? AND cancelled = 0 AND assigned_to IS NULL
        AND unfilled_alert_sent_at IS NULL AND unfilled_alert_until <= ?
        AND start_at > ? AND start_at <= ? AND EXISTS (
          SELECT 1 FROM chain_watch_schedules w WHERE w.id = chain_watch_slots.watch_id
            AND w.is_open = 1 AND w.guild_id = ? AND chain_watch_slots.start_at >= w.start_at
            AND (w.finish_at IS NULL OR chain_watch_slots.start_at < w.finish_at)
        )`).bind(token, sendAt + 120, slot.watch_id, slot.start_at, sendAt, sendAt,
          sendAt + WATCH_UNFILLED_SLOT_LEAD_SECONDS, guildId).run();
    if (!lease.meta.changes) continue;
    try {
      const from = new Date(slot.start_at * 1000).toISOString().slice(11, 16);
      const to = new Date((slot.start_at + WATCH_HOUR) * 1000).toISOString().slice(11, 16);
      const channelId = discordNotificationChannelTargetId(route);
      const delivery = await sendWatchDiscordMessage(env, channelId, {
          content: mentions.messageSuffix,
          embeds: [{
            title: "⚠️ Chain watch unfilled slot",
            description: `**${escaped(slot.name)}** has no watcher assigned.\n` +
              `Slot: ${from} - ${to} UTC\n` +
              `Starts <t:${slot.start_at}:R>.\n${signUpLink}`,
            color: 0xff0000,
          }],
          allowed_mentions: {
            parse: mentions.allowedMentions?.everyone ? ["everyone"] : [],
            users: mentions.allowedMentions?.users ?? [],
            roles: mentions.allowedMentions?.roles ?? [],
          },
        }, `${alertKey}:${slot.watch_id}:${slot.start_at}`);
      if (delivery.status === "failed") throw delivery.error;
      await env.DB.prepare(`UPDATE chain_watch_slots SET unfilled_alert_sent_at = ?,
          unfilled_alert_message_id = ?, unfilled_alert_channel_id = ?
        WHERE watch_id = ? AND start_at = ? AND unfilled_alert_token = ?`)
        .bind(sendAt, delivery.value, channelId, slot.watch_id, slot.start_at, token).run();
    } finally {
      await env.DB.prepare(`UPDATE chain_watch_slots SET unfilled_alert_token = NULL, unfilled_alert_until = 0
        WHERE watch_id = ? AND start_at = ? AND unfilled_alert_token = ?`)
        .bind(slot.watch_id, slot.start_at, token).run();
    }
  }
}

export async function runWatchScheduleCron(env: Env, now = nowSeconds()): Promise<void> {
  try { await processWatchScheduleCron(env, now); }
  finally { await cleanupWatchUnfilledSlotAlerts(env, now); }
}

async function processWatchScheduleCron(env: Env, now: number): Promise<void> {
  const checkedAt = Math.max(now, nowSeconds());
  await reconcileWatch(env, checkedAt);
  // A new watch's info must arrive before any roster or reminder in its channel.
  // Once info succeeds, ordinary roster failures must not suppress alerts.
  const watch = await currentWatch(env);
  if (watch) {
    const data = await readWatch(env, watch.id);
    if (data.slots.some(slot => !slot.cancelled) && !await ensureWatchInfo(env, data, checkedAt)) return;
  }
  // Publish or refresh the sheet before linking it, while still warning if roster delivery fails.
  try {
    try { await syncWatchBoards(env, checkedAt); }
    finally { await runWatchCheckIns(env, checkedAt); }
  } finally {
    await sendWatchUnfilledSlotAlerts(env, checkedAt);
  }
}
