import { createsLongWatchRun, watchUtc, WATCH_HOUR, type ChainWatchSheet, type ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { changeWatchSlots, createWatch, currentWatch, readWatch, reconcileWatch, setWatchFinish, WatchError, watchDiscordMember } from "./chainWatchSchedule";
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
  return (interaction.type === 2 && interaction.data?.name === "chain-watch") ||
    (interaction.type === 3 && Boolean(interaction.data?.custom_id?.startsWith(WATCH_COMPONENT_PREFIX)));
}

function privateWatchMessage(content: string, components?: NonNullable<DiscordInteractionResponse["data"]>["components"]): DiscordInteractionResponse {
  return { type: 4, data: { content, components, flags: 64, allowed_mentions: { parse: [] } } };
}

function escaped(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
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
        return privateWatchMessage(`Created **${escaped(watch.name)}**, starting ${watchUtc(watch.start_at)}. The roster will appear in this channel.`, [{ type: 1, components: [{ type: 2, style: 5, label: "Open page", url: watchPageUrl(env, watch.id) }] }]);
      }
      if (command?.name === "setfinish") {
        const watch = await currentWatch(env);
        if (!watch || watch.guild_id !== guildId) throw new WatchError("There is no unfinished watch.");
        const finish = await setWatchFinish(env, watch.id, option("finish"));
        return privateWatchMessage(`**${escaped(watch.name)}** will finish at ${watchUtc(finish)}. Slots starting then or later are cancelled; earlier assignments are preserved.`);
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
      return privateWatchMessage(`${selection.action === "claim" ? "Signed up for" : "Left"} ${starts.length} slot${starts.length === 1 ? "" : "s"}. The shared roster is updating.`);
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

    if (parts[1] === "open") {
      if (!available.length) return privateWatchMessage(action === "leave" ? "You have no future assignments on this sheet." : "There are no available slots you can take on this sheet.");
      return privateWatchMessage(`${action === "claim" ? "Choose slots to claim" : "Choose your slots to leave"}. All times are UTC. You will confirm before saving.`, [{ type: 1, components: [{
        type: 3, custom_id: `cws:pick:${action}:${sheetId}`, placeholder: "Choose hourly slots", min_values: 1, max_values: available.length,
        options: available.map((slot) => ({ label: `${watchUtc(slot.start_at)} – ${new Date((slot.start_at + WATCH_HOUR) * 1000).toISOString().slice(11, 16)}`, value: String(slot.start_at) })),
      }] }]);
    }

    const selected = interaction.data?.values ?? [];
    if (!selected.length || selected.length > 24 || selected.some((value) => !/^\d+$/.test(value))) throw new WatchError("Choose valid slots.");
    const starts = [...new Set(selected.map(Number))];
    if (starts.some((start) => !available.some((slot) => slot.start_at === start))) throw new WatchError("A selected slot is no longer available. Open the selector again.");
    if (action === "claim") {
      const finalHours = new Set([...mine, ...starts]);
      if (starts.some((start) => createsLongWatchRun(finalHours, start))) throw new WatchError("Your selection needs at least one hour off after two consecutive slots.");
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO chain_watch_pending_selections(id, discord_user_id, guild_id, watch_id, action, starts_json, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, guildId, sheet.watch_id, action, JSON.stringify(starts), nowSeconds() + 10 * 60).run();
    return privateWatchMessage(`Confirm ${action === "claim" ? "sign-up" : "leaving"}:\n${starts.map((start) => watchUtc(start)).join("\n")}`, [{ type: 1, components: [{ type: 2, style: action === "claim" ? 3 : 4, label: action === "claim" ? "Confirm sign-up" : "Confirm leave", custom_id: `cws:confirm:${id}` }] }]);
  } catch (error) {
    if (error instanceof WatchError) return privateWatchMessage(error.message);
    console.error("Chain watch interaction failed", error instanceof Error ? error.message : "Unknown error");
    return privateWatchMessage("Chain watch is temporarily unavailable. Try again shortly.");
  }
}

export function watchBoardPayload(env: Env, data: ChainWatchScheduleResponse, sheet: ChainWatchSheet) {
  const watch = data.watch!;
  const slots = data.slots.filter((slot) => slot.sheet_id === sheet.id);
  const future = slots.some((slot) => !slot.cancelled && slot.start_at > data.now);
  const rows = slots.map((slot) => {
    const hour = new Date(slot.start_at * 1000).toISOString().slice(11, 16);
    const date = new Date(slot.start_at * 1000).toISOString().slice(5, 10);
    const who = slot.assigned_to ? escaped((slot.member_name ?? `Player ${slot.assigned_to}`).slice(0, 32)) : "Available";
    const status = slot.cancelled ? "Cancelled" : slot.start_at + WATCH_HOUR <= data.now ? "Ended" : slot.start_at <= data.now ? "On watch" : "";
    return `${date} **${hour}** · ${who}${status ? ` · ${status}` : ""}`;
  });
  const effectiveEnd = Math.min(sheet.end_at, watch.finish_at ?? sheet.end_at);
  return {
    content: "",
    embeds: [{
      title: `${escaped(watch.name)} · Chain watch`, color: 0x2f80ed,
      description: `${watchUtc(sheet.start_at)} → ${watchUtc(Math.max(sheet.start_at, effectiveEnd))}\nEach slot lasts one hour. All times UTC.\n\n${rows.join("\n")}`,
      footer: { text: `${slots.filter((slot) => !slot.cancelled && slot.assigned_to).length}/${slots.filter((slot) => !slot.cancelled).length} filled · Two consecutive hours maximum · ${watch.finish_at ? `Watch finishes ${watchUtc(watch.finish_at)}` : "Rolling 24-hour sheets"}` },
    }],
    allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: "Sign up", custom_id: `cws:open:claim:${sheet.id}`, disabled: !future },
      { type: 2, style: 2, label: "Leave slots", custom_id: `cws:open:leave:${sheet.id}`, disabled: !future },
      { type: 2, style: 5, label: "Open page", url: watchPageUrl(env, watch.id) },
    ] }],
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
