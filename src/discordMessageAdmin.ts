import type { DiscordMessageDeleteResult, DiscordMessagePreview } from "../shared/discordMessageAdmin";
import { readJsonObject } from "./backend/request";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

type MessageLink = { guildId: string; channelId: string; messageId: string; url: string };
type DiscordMessageOperation = "channel_lookup" | "bot_identity" | "message_lookup" | "message_delete";
type DiscordFailureDetails = { operation: DiscordMessageOperation; discord_status: number; discord_code: number | null };
const DISCORD_USER_AGENT = "DiscordBot (https://github.com/Moose-github/torn-faction-attacks, 1.0)";
type DiscordMessage = {
  id: string; channel_id: string; author: { id: string; username?: string; global_name?: string };
  timestamp?: string; content?: string;
  embeds?: Array<{ title?: string; description?: string; fields?: Array<{ name: string; value: string }>; footer?: { text?: string } }>;
  attachments?: Array<{ filename?: string }>;
};

class MessageAdminError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details?: DiscordFailureDetails) { super(message); }
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
    const channel = await discordRequest<{ id: string; guild_id?: string; name?: string }>(env, `/channels/${link.channelId}`, "channel_lookup");
    if (channel.id !== link.channelId || channel.guild_id !== link.guildId) {
      throw new MessageAdminError("This channel is not in the faction Discord server.", 403, "WRONG_DISCORD_SERVER");
    }
    const [bot, message] = await Promise.all([
      discordRequest<{ id: string; bot?: boolean }>(env, "/users/@me", "bot_identity"),
      discordRequest<DiscordMessage>(env, `/channels/${link.channelId}/messages/${link.messageId}`, "message_lookup"),
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
        `/channels/${link.channelId}/messages/${link.messageId}`, "message_delete");
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
    if (error instanceof MessageAdminError) {
      if (error.details) console.warn("Discord message admin request failed", error.details);
      return json({ ok: false, error: error.message, code: error.code, ...error.details }, error.status);
    }
    return json({ ok: false, error: "Unable to reach Discord. Please try again.", code: "DISCORD_UNAVAILABLE" }, 502);
  }
}

async function discordRequest<T>(env: Env, path: string, operation: DiscordMessageOperation): Promise<T> {
  const method = operation === "message_delete" ? "DELETE" : "GET";
  // Only validated IDs are interpolated into paths on this fixed API origin.
  const response = await fetchExternal(`https://discord.com/api/v10${path}`, {
    method, headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN!.trim()}`,
      "User-Agent": DISCORD_USER_AGENT,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  }, { timeoutMs: 10_000 });
  if (method === "DELETE" && (response.ok || response.status === 404)) {
    return { ok: true, already_deleted: response.status === 404 } as T;
  }
  if (!response.ok) {
    // A proxy/edge 403 is not necessarily Discord's Missing Access or Missing
    // Permissions response. Keep the operation and numeric code, never raw HTML,
    // upstream messages, request headers or message contents.
    const body = await response.json<{ code?: unknown }>().catch(() => null);
    const discordCode = typeof body?.code === "number" && Number.isSafeInteger(body.code) ? body.code : null;
    throw discordResponseError(operation, response.status, discordCode);
  }
  return response.json<T>();
}

function discordResponseError(operation: DiscordMessageOperation, status: number, discordCode: number | null): MessageAdminError {
  const details = { operation, discord_status: status, discord_code: discordCode };
  const step = { channel_lookup: "channel lookup", bot_identity: "bot identity check", message_lookup: "message lookup", message_delete: "message deletion" }[operation];
  const reason = `(HTTP ${status}${discordCode === null ? "; no Discord error code" : `; Discord ${discordCode}`})`;
  const failure = (message: string, code: string, responseStatus = status) =>
    new MessageAdminError(`${message} Failed at ${step} ${reason}.`, responseStatus, code, details);
  if (status === 401) return failure("Discord rejected the bot token. Check the deployed bot configuration.", "DISCORD_AUTH_FAILED", 503);
  if (status === 404) return failure("Message or channel not found. It may already be deleted or inaccessible to the bot.", "DISCORD_MESSAGE_NOT_FOUND");
  if (status === 429) return failure("Discord is rate limiting requests. Please wait and try again.", "DISCORD_RATE_LIMITED");
  if (discordCode === 40333) return failure(
    "Discord's edge protection blocked the request. This is not a channel-permission error.", "DISCORD_REQUEST_BLOCKED", 502);
  if (status === 403 && (discordCode === 50001 || discordCode === 50013)) {
    if (operation === "message_lookup") return failure(
      "The bot cannot read this message. Preview requires View Channel and Read Message History in the linked channel or thread.", "DISCORD_MESSAGE_READ_DENIED");
    if (operation === "channel_lookup") return failure(
      "The bot cannot access the linked channel. Check View Channel, channel overrides and private-thread membership.", "DISCORD_CHANNEL_ACCESS_DENIED");
    if (operation === "message_delete") return failure(
      "Discord denied deletion after the message was verified as this bot's. Check whether its channel or thread access has changed.", "DISCORD_MESSAGE_DELETE_DENIED");
    return failure("Discord denied the bot identity check. Check the deployed bot configuration.", "DISCORD_BOT_IDENTITY_DENIED");
  }
  if (status === 403) return failure(
    "Discord rejected the request without a channel-permission error. This may be a request or network-level rejection.", "DISCORD_REQUEST_REJECTED", 502);
  return failure("Discord could not complete the request. Please try again.", "DISCORD_REQUEST_FAILED", 502);
}
