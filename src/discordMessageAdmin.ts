import type { DiscordMessageDeleteResult, DiscordMessagePreview } from "../shared/discordMessageAdmin";
import { readJsonObject } from "./backend/request";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

type MessageLink = { guildId: string; channelId: string; messageId: string; url: string };
type DiscordMessage = {
  id: string; channel_id: string; author: { id: string; username?: string; global_name?: string };
  timestamp?: string; content?: string;
  embeds?: Array<{ title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text?: string } }>;
  attachments?: Array<{ filename?: string }>;
};

class MessageAdminError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export function parseDiscordMessageLink(value: unknown): MessageLink {
  const invalid = () => new MessageAdminError("Paste a Discord message link using Copy Message Link.", 400, "INVALID_MESSAGE_LINK");
  if (typeof value !== "string" || value.length > 2000) throw invalid();
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !/^(?:(?:www|canary|ptb)\.)?discord(?:app)?\.com$/.test(url.hostname)) throw invalid();
  const match = url.pathname.match(/^\/channels\/(\d{5,32})\/(\d{5,32})\/(\d{5,32})\/?$/);
  if (!match) throw invalid();
  const [, guildId, channelId, messageId] = match;
  return { guildId, channelId, messageId, url: `https://discord.com/channels/${guildId}/${channelId}/${messageId}` };
}

export function previewDiscordBotMessageFromRequest(request: Request, env: Env): Promise<Response> {
  return manageMessage(request, env, false);
}

export function deleteDiscordBotMessageFromRequest(request: Request, env: Env): Promise<Response> {
  return manageMessage(request, env, true);
}

async function manageMessage(request: Request, env: Env, remove: boolean): Promise<Response> {
  try {
    const link = parseDiscordMessageLink((await readJsonObject(request)).message_link);
    if (!env.DISCORD_GUILD_ID?.trim() || !env.DISCORD_BOT_TOKEN?.trim()) {
      throw new MessageAdminError("The Discord bot is not configured.", 503, "DISCORD_NOT_CONFIGURED");
    }
    if (link.guildId !== env.DISCORD_GUILD_ID.trim()) {
      throw new MessageAdminError("Choose a message from the faction Discord server.", 403, "WRONG_DISCORD_SERVER");
    }
    // The guild in a pasted link can be changed. Verify the actual channel too.
    const channel = await discordRequest<{ id: string; guild_id?: string; name?: string }>(env, `/channels/${link.channelId}`);
    if (channel.id !== link.channelId || channel.guild_id !== link.guildId) {
      throw new MessageAdminError("This channel is not in the faction Discord server.", 403, "WRONG_DISCORD_SERVER");
    }
    const [bot, message] = await Promise.all([
      discordRequest<{ id: string; bot?: boolean }>(env, "/users/@me"),
      discordRequest<DiscordMessage>(env, `/channels/${link.channelId}/messages/${link.messageId}`),
    ]);
    if (!bot.bot || !bot.id || message.author?.id !== bot.id) {
      throw new MessageAdminError("Only messages sent by this bot can be deleted here.", 403, "MESSAGE_NOT_OWNED");
    }
    if (message.id !== link.messageId || message.channel_id !== link.channelId) {
      throw new MessageAdminError("Discord returned an unexpected message. Please try again.", 502, "INVALID_DISCORD_RESPONSE");
    }
    if (remove) {
      // Recheck ownership on every delete, independently of the browser preview.
      const result = await discordRequest<DiscordMessageDeleteResult>(env,
        `/channels/${link.channelId}/messages/${link.messageId}`, "DELETE");
      return json(result);
    }
    return json({
      ok: true, message_link: link.url, message_id: message.id,
      channel_name: channel.name ?? link.channelId,
      author_name: message.author.global_name ?? message.author.username ?? "Bot",
      timestamp: message.timestamp ?? null, content: message.content ?? "",
      embeds: (message.embeds ?? []).map((embed) => ({ title: embed.title ?? "", description: embed.description ?? "",
        fields: embed.fields ?? [], footer: embed.footer?.text ?? "" })),
      attachments: (message.attachments ?? []).map((attachment) => attachment.filename ?? "Attachment"),
    } satisfies DiscordMessagePreview);
  } catch (error) {
    if (error instanceof MessageAdminError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    return json({ ok: false, error: "Unable to reach Discord. Please try again.", code: "DISCORD_UNAVAILABLE" }, 502);
  }
}

async function discordRequest<T>(env: Env, path: string, method: "GET" | "DELETE" = "GET"): Promise<T> {
  // Only validated IDs are interpolated into paths on this fixed API origin.
  const response = await fetchExternal(`https://discord.com/api/v10${path}`, {
    method, headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN!.trim()}` },
  }, { timeoutMs: 10_000 });
  if (method === "DELETE" && (response.ok || response.status === 404)) {
    return { ok: true, already_deleted: response.status === 404 } as T;
  }
  if (response.status === 404) throw new MessageAdminError("Message or channel not found. It may already be deleted or inaccessible to the bot.", 404, "DISCORD_MESSAGE_NOT_FOUND");
  if (response.status === 403) throw new MessageAdminError("The bot cannot access or manage this message. Check its channel permissions.", 403, "DISCORD_ACCESS_DENIED");
  if (response.status === 429) throw new MessageAdminError("Discord is rate limiting requests. Please wait and try again.", 429, "DISCORD_RATE_LIMITED");
  if (!response.ok) throw new MessageAdminError("Discord could not complete the request. Please try again.", 502, "DISCORD_REQUEST_FAILED");
  return response.json<T>();
}
