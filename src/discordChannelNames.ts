import { fetchExternal } from "./external/http";
import type { Env } from "./types";

type DiscordChannel = { id: string; guild_id?: string; name?: string };

// Resolve display names only; a failed lookup must never hide or change a route.
export async function readDiscordChannelNames(
  env: Env,
  guildId: string,
  channelIds: Iterable<string>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = new Set(Array.from(channelIds).filter((id) => /^\d{5,32}$/.test(id)));
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!token || !/^\d{5,32}$/.test(guildId) || ids.size === 0) return names;

  async function read(path: string): Promise<unknown> {
    try {
      const response = await fetchExternal(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bot ${token}` },
      }, { timeoutMs: 5_000 });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  // One request resolves ordinary channels shared by multiple alert rows.
  const channels = await read(`/guilds/${guildId}/channels`);
  if (!Array.isArray(channels)) return names;
  for (const channel of channels as Array<DiscordChannel | null>) {
    if (channel && ids.has(channel.id) && (!channel.guild_id || channel.guild_id === guildId)
      && typeof channel.name === "string" && channel.name.trim()) {
      names.set(channel.id, channel.name);
    }
  }

  // Discord's guild channel list excludes threads, including archived threads.
  await Promise.all(Array.from(ids).filter((id) => !names.has(id)).map(async (id) => {
    const channel = await read(`/channels/${id}`) as DiscordChannel | null;
    if (channel?.id === id && channel.guild_id === guildId
      && typeof channel.name === "string" && channel.name.trim()) {
      names.set(id, channel.name);
    }
  }));
  return names;
}
