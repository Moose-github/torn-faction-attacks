import { createsLongWatchRun, nextWatchHour, watchDate, watchUtc, WATCH_DAY, WATCH_HOUR, type ChainWatchSheet, type ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, currentWatch, parseWatchTime, readWatch, reconcileWatch, setWatchFinish, WatchError, watchDiscordMember } from "./chainWatchSchedule";
import { CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING } from "./discordCommands";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { assertExternalResponseOk, ExternalApiError, fetchExternal, readExternalJson } from "./external/http";
import type { Env } from "./types";
import { nowSeconds } from "./utils";

export const WATCH_COMPONENT_PREFIX = "cws:";

export function canManageWatchOnDiscord(permissions: string | undefined, publicTesting: boolean = CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING): boolean {
  if (publicTesting) return true;
  try { return (BigInt(permissions ?? "0") & 8n) === 8n; } catch { return false; }
}

export function isWatchInteraction(interaction: DiscordInteraction): boolean {
  return ((interaction.type === 2 || interaction.type === 4) && interaction.data?.name === "chain-watch") ||
    (interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_COMPONENT_PREFIX)));
}

function updatesWatchMessage(interaction: DiscordInteraction): boolean {
  return interaction.type === 3 && /^(cws:pick:|cws:confirm:)/.test(interaction.data?.custom_id ?? "");
}

export function deferredWatchResponse(interaction: DiscordInteraction): DiscordInteractionResponse {
  return updatesWatchMessage(interaction) ? { type: 6 } : { type: 5, data: { flags: 64 } };
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
  return { type: 8, data: { choices } };
}

function escaped(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}

function watchSlotLabel(start: number): string {
  const from = new Date(start * 1000).toISOString().slice(11, 16);
  const end = start + WATCH_HOUR;
  const to = end % WATCH_DAY === 0 ? "24:00" : new Date(end * 1000).toISOString().slice(11, 16);
  return `${from}–${to}`;
}

export function watchPageUrl(env: Env, watchId: string): string {
  return `${(env.DASHBOARD_BASE_URL ?? "https://buttgrass.pages.dev").replace(/\/$/, "")}/chain-watch?watch=${encodeURIComponent(watchId)}`;
}

async function discordRequest<T>(env: Env, path: string, method: string, body: unknown, webhook = false): Promise<T> {
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
  const response = await handleWatchInteraction(interaction, env);
  try {
    const { flags: _flags, ...data } = response.data ?? {};
    await discordRequest(env, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, "PATCH", data, true);
  } catch (error) {
    console.error("Unable to complete chain watch reply", error instanceof ExternalApiError ? error.status : "transport error");
  }
  await syncWatchBoardsSafely(env);
}

export async function handleWatchInteraction(interaction: DiscordInteraction, env: Env): Promise<DiscordInteractionResponse> {
  if (interaction.type === 4) return watchAutocompleteResponse(interaction, env);
  const update = updatesWatchMessage(interaction);
  const reply = (content: string, components: NonNullable<DiscordInteractionResponse["data"]>["components"] = []): DiscordInteractionResponse => ({
    type: update ? 7 : 4,
    data: { content, components, ...(!update ? { flags: 64 } : {}), allowed_mentions: { parse: [] } },
  });
  try {
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
        const watch = await currentWatch(env);
        if (!watch || watch.guild_id !== guildId) throw new WatchError("There is no unfinished watch.");
        const finish = await setWatchFinish(env, watch.id, option("finish"));
        return reply(`**${escaped(watch.name)}** will finish at ${watchUtc(finish)}. Slots starting then or later are cancelled; earlier assignments are preserved.`);
      }
      throw new WatchError("Use /chain-watch create or /chain-watch setfinish.");
    }

    const actorId = await watchDiscordMember(env, userId);
    const parts = (interaction.data?.custom_id ?? "").split(":");
    if (parts[1] === "confirm") {
      const selection = await env.DB.prepare(`SELECT * FROM chain_watch_pending_selections
        WHERE id = ? AND discord_user_id = ? AND guild_id = ? AND expires_at > ?`)
        .bind(parts[2] ?? "", userId, guildId, nowSeconds())
        .first<{ id: string; watch_id: string; action: "claim" | "leave"; starts_json: string }>();
      if (!selection) throw new WatchError("This selection expired or was already used. Open Sign up or Leave slots again.");
      const data = await readWatch(env, selection.watch_id);
      if (data.watch?.guild_id !== guildId) throw new WatchError("This watch belongs to another server.", 403);
      const starts: number[] = JSON.parse(selection.starts_json);
      await changeWatchSlots(env, { watchId: selection.watch_id, starts, actorId, targetId: selection.action === "claim" ? actorId : null, admin: false });
      await env.DB.prepare("DELETE FROM chain_watch_pending_selections WHERE id = ?").bind(selection.id).run();
      return reply(`${selection.action === "claim" ? "Signed up for" : "Left"} ${starts.length} slot${starts.length === 1 ? "" : "s"}. The shared roster is updating.`);
    }

    const action = parts[2];
    const sheetId = parts.slice(3).join(":");
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
        type: 3, custom_id: `cws:pick:${action}:${sheetId}`, placeholder: "Choose hourly slots", min_values: 1, max_values: available.length,
        options: available.map((slot) => ({ label: watchSlotLabel(slot.start_at), value: String(slot.start_at), default: starts.includes(slot.start_at) })),
      }] }, { type: 1, components: [{
        type: 2, style: action === "claim" ? 3 : 4, label: action === "claim" ? "Confirm sign-up" : "Confirm leave",
        custom_id: `cws:confirm:${selectionId ?? "empty"}`, disabled: !selectionId,
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
    return selectionMessage(starts, id);
  } catch (error) {
    if (error instanceof WatchError) return reply(error.message);
    console.error("Chain watch interaction failed", error instanceof Error ? error.message : "Unknown error");
    return reply("Chain watch is temporarily unavailable. Try again shortly.");
  }
}

export function watchBoardPayload(env: Env, data: ChainWatchScheduleResponse, sheet: ChainWatchSheet) {
  const watch = data.watch!;
  const slots = data.slots.filter((slot) => slot.sheet_id === sheet.id);
  const future = slots.some((slot) => !slot.cancelled && slot.start_at > data.now);
  const newestSheet = data.sheets.every((candidate) => candidate.start_at <= sheet.start_at);
  const nextDayNotice = watch.is_open && watch.finish_at === null && newestSheet ? "\nNext day published at 12:00 UTC" : "";
  const rows = slots.map((slot) => {
    const hour = new Date(slot.start_at * 1000).toISOString().slice(11, 16);
    const who = slot.assigned_to ? escaped((slot.member_name ?? `Player ${slot.assigned_to}`).slice(0, 32)) : "Available";
    const status = slot.cancelled ? "Cancelled" : slot.start_at + WATCH_HOUR <= data.now ? "Ended" : slot.start_at <= data.now ? "On watch" : "";
    return `**${hour}** · ${who}${status ? ` · ${status}` : ""}`;
  });
  return {
    content: "",
    embeds: [{
      title: `${escaped(watch.name)} · ${watchDate(sheet.start_at)} · Chain watch`, color: 0x2f80ed,
      description: rows.join("\n"),
      footer: { text: `${slots.filter((slot) => !slot.cancelled && slot.assigned_to).length}/${slots.filter((slot) => !slot.cancelled).length} filled · Two consecutive hours maximum${watch.finish_at ? ` · Watch finishes ${watchUtc(watch.finish_at)}` : nextDayNotice}` },
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
  try { await syncWatchBoards(env); } catch (error) { console.error("Chain watch roster sync will retry", error instanceof Error ? error.message : "Unknown error"); }
}

export async function syncWatchBoards(env: Env, now = nowSeconds()): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN) return;
  const stopAt = Date.now() + 15_000;
  const errors: unknown[] = [];
  const hour = Math.floor(now / WATCH_HOUR);
  const rows = await env.DB.prepare(`SELECT id FROM chain_watch_sheets WHERE dirty > 0
    OR (start_at <= ? AND end_at >= ? AND render_hour != ?) ORDER BY start_at LIMIT 30`).bind(now, now - WATCH_HOUR, hour).all<{ id: string }>();
  for (const row of rows.results) {
    if (Date.now() >= stopAt) break;
    const token = crypto.randomUUID();
    const lease = await env.DB.prepare("UPDATE chain_watch_sheets SET sync_token = ?, sync_until = ? WHERE id = ? AND sync_until <= ?").bind(token, now + 60, row.id, now).run();
    if (!lease.meta.changes) continue;
    try {
      const sheet = (await env.DB.prepare("SELECT * FROM chain_watch_sheets WHERE id = ?").bind(row.id).first<ChainWatchSheet & { dirty: number; last_payload: string | null }>())!;
      const data = await readWatch(env, sheet.watch_id);
      if (!sheet.discord_message_id && data.slots.filter((slot) => slot.sheet_id === sheet.id).every((slot) => slot.cancelled)) {
        await env.DB.prepare("UPDATE chain_watch_sheets SET dirty = MAX(0, dirty - ?), render_hour = ? WHERE id = ? AND sync_token = ?")
          .bind(sheet.dirty, hour, row.id, token).run();
        continue;
      }
      const payload = watchBoardPayload(env, data, sheet);
      const serialized = JSON.stringify(payload);
      let messageId = sheet.discord_message_id;
      if (messageId && sheet.last_payload !== serialized) {
        try { await discordRequest(env, `/channels/${data.watch!.channel_id}/messages/${messageId}`, "PATCH", payload); }
        catch (error) { if (error instanceof ExternalApiError && error.status === 404) messageId = null; else throw error; }
      }
      if (!messageId) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sheet.id)));
        const nonce = Array.from(digest.slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
        const message = await discordRequest<{ id: string }>(env, `/channels/${data.watch!.channel_id}/messages`, "POST", { ...payload, nonce, enforce_nonce: true });
        if (!message.id) throw new Error("Discord did not return a roster message ID");
        messageId = message.id;
      }
      await env.DB.prepare(`UPDATE chain_watch_sheets SET discord_message_id = ?, last_payload = ?, render_hour = ?, dirty = MAX(0, dirty - ?)
        WHERE id = ? AND sync_token = ?`).bind(messageId, serialized, hour, sheet.dirty, row.id, token).run();
    } catch (error) {
      errors.push(error);
    } finally {
      await env.DB.prepare("UPDATE chain_watch_sheets SET sync_token = NULL, sync_until = 0 WHERE id = ? AND sync_token = ?").bind(row.id, token).run();
    }
  }
  if (errors.length) throw errors[0];
}

export async function runWatchScheduleCron(env: Env, now = nowSeconds()): Promise<void> {
  await reconcileWatch(env, now);
  await syncWatchBoards(env, now);
}
