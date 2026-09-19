import type { DiscordRouteDestination, DiscordRouteDestinationsResponse } from "../shared/discordRouteAdmin";
import { readJsonObject } from "./backend/request";
import { discordAlertRouteByKey } from "./discordAlerts";
import { getAdminDiscordAlertSettings } from "./discordAlertSettings";
import { readDiscordNotificationGuildId, setDiscordNotificationChannel, unsetDiscordNotificationChannel } from "./discordNotificationChannels";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

type Channel = {
  id: string; guild_id?: string; name: string; type: number; parent_id?: string | null;
  thread_metadata?: { archived?: boolean; locked?: boolean };
};
const channelTypes = new Set([0, 5]);
const threadTypes = new Set([10, 11, 12]);
const validId = (value: unknown): value is string => typeof value === "string" && /^\d{5,32}$/.test(value);
const isChannel = (value: unknown): value is Channel => !!value && typeof value === "object"
  && validId((value as Channel).id) && typeof (value as Channel).name === "string"
  && typeof (value as Channel).type === "number";

export class RouteError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readDiscord(env: Env, path: string): Promise<unknown> {
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new RouteError("The Discord bot is not configured.", 503);
  const response = await fetchExternal(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  }, { timeoutMs: 5_000 });
  if (response.status === 429) throw new RouteError("Discord is busy. Please try again shortly.", 429);
  if (response.status === 403 || response.status === 404) {
    throw new RouteError("The bot cannot access this channel or server. Check its Discord permissions.", 403);
  }
  if (!response.ok) throw new RouteError("Unable to load Discord channels. Please try again.", 502);
  return response.json();
}

function configuredGuild(env: Env): string {
  const guildId = readDiscordNotificationGuildId(env);
  if (!validId(guildId)) throw new RouteError("The faction Discord server is not configured.", 503);
  return guildId;
}

function routeErrorResponse(error: unknown): Response {
  return json({ ok: false, error: error instanceof RouteError ? error.message : "Unable to update or load Discord routes. Please try again." },
    error instanceof RouteError ? error.status : 502);
}

export async function getAdminDiscordRouteDestinations(env: Env): Promise<Response> {
  try {
    const guildId = configuredGuild(env);
    const [channelsResult, threadsResult] = await Promise.allSettled([
      readDiscord(env, `/guilds/${guildId}/channels`),
      readDiscord(env, `/guilds/${guildId}/threads/active`),
    ]);
    if (channelsResult.status === "rejected") throw channelsResult.reason;
    if (!Array.isArray(channelsResult.value)) throw new RouteError("Discord returned an invalid channel list.", 502);
    const channels = channelsResult.value.filter(isChannel).filter(channel => !channel.guild_id || channel.guild_id === guildId);
    const parentNames = new Map(channels.map(channel => [channel.id, channel.name]));
    const destinations: DiscordRouteDestination[] = channels.filter(channel => channelTypes.has(channel.type))
      .map(channel => ({ id: channel.id, name: channel.name, kind: "channel", parent_name: null }));
    const threads = threadsResult.status === "fulfilled"
      ? (threadsResult.value as { threads?: unknown } | null)?.threads : null;
    if (Array.isArray(threads)) {
      for (const thread of threads.filter(isChannel)) {
        if (thread.guild_id !== guildId || !threadTypes.has(thread.type) || !validId(thread.parent_id)
          || thread.thread_metadata?.archived || thread.thread_metadata?.locked) continue;
        destinations.push({ id: thread.id, name: thread.name, kind: "thread", parent_name: parentNames.get(thread.parent_id) ?? null });
      }
    }
    destinations.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    return json({ ok: true, destinations, threads_error: Array.isArray(threads) ? null : "Active threads could not be loaded. You can still choose a channel." } satisfies DiscordRouteDestinationsResponse);
  } catch (error) { return routeErrorResponse(error); }
}

export async function updateAdminDiscordRouteFromRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const alert = typeof body.alert_key === "string" ? discordAlertRouteByKey(body.alert_key) : null;
    if (!alert) throw new RouteError("Unknown Discord alert route.", 400);
    const guildId = configuredGuild(env);
    if (body.target_id === null) {
      await unsetDiscordNotificationChannel(env, guildId, alert.key);
    } else {
      const { channel } = await requireDiscordDestination(env, body.target_id);
      const isThread = threadTypes.has(channel.type);
      await setDiscordNotificationChannel(env, {
        guildId, alertKey: alert.key, channelId: isThread ? channel.parent_id! : channel.id,
        threadId: isThread ? channel.id : null, updatedByDiscordId: null,
      });
    }
    return await getAdminDiscordAlertSettings(env);
  } catch (error) { return routeErrorResponse(error); }
}

export async function requireDiscordDestination(env: Env, targetId: unknown): Promise<{ guildId: string; channel: Channel }> {
  if (!validId(targetId)) throw new RouteError("Choose a Discord channel or active thread.", 400);
  const guildId = configuredGuild(env);
  const channel = await readDiscord(env, `/channels/${targetId}`);
  if (!isChannel(channel) || channel.id !== targetId || channel.guild_id !== guildId) {
    throw new RouteError("Choose a channel from the faction Discord server.", 400);
  }
  const isThread = threadTypes.has(channel.type);
  if (!channelTypes.has(channel.type) && !isThread) throw new RouteError("Choose a text channel, announcement channel or active thread.", 400);
  if (isThread) {
    if (!validId(channel.parent_id) || channel.thread_metadata?.archived || channel.thread_metadata?.locked) {
      throw new RouteError("Choose an active, unlocked Discord thread.", 400);
    }
    const parent = await readDiscord(env, `/channels/${channel.parent_id}`);
    if (!isChannel(parent) || parent.id !== channel.parent_id || parent.guild_id !== guildId) {
      throw new RouteError("The thread's parent must belong to the faction Discord server.", 400);
    }
  }
  return { guildId, channel };
}
