import type { DiscordMessageDeleteResult, DiscordMessagePreview } from "../shared/discordMessageAdmin";
import { readJsonObject } from "./backend/request";
import { canDeleteOtherDiscordMessages, type DiscordPermissionChannel, type DiscordPermissionGuild, type DiscordPermissionMember } from "./discordMessagePermissions";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

type MessageLink = { guildId: string; channelId: string; messageId: string; url: string };
type DiscordMessageOperation = "channel_lookup" | "bot_identity" | "message_lookup" | "message_delete" | "guild_permissions" | "bot_membership" | "parent_channel";
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
    const channel = await discordRequest<DiscordPermissionChannel>(env, `/channels/${link.channelId}`, "channel_lookup");
    if (channel.id !== link.channelId || channel.guild_id !== link.guildId) {
      throw new MessageAdminError("This channel is not in the faction Discord server.", 403, "WRONG_DISCORD_SERVER");
    }
    const [bot, message] = await Promise.all([
      discordRequest<{ id: string; bot?: boolean }>(env, "/users/@me", "bot_identity"),
      discordRequest<DiscordMessage>(env, `/channels/${link.channelId}/messages/${link.messageId}`, "message_lookup")
        .catch(error => {
          if (remove && error instanceof MessageAdminError && error.code === "DISCORD_MESSAGE_READ_DENIED") return null;
          throw error;
        }),
    ]);
    if (!bot.bot || !/^\d{5,32}$/.test(bot.id) || (message && message.author?.id !== bot.id)) {
      throw new MessageAdminError("Only messages sent by this bot can be deleted here.", 403, "MESSAGE_NOT_OWNED");
    }
    if (message && (message.id !== link.messageId || message.channel_id !== link.channelId)) {
      throw new MessageAdminError("Discord returned an unexpected message. Please try again.", 502, "INVALID_DISCORD_RESPONSE");
    }
    if (remove) {
      // Never trust a prior browser preview. If reading fails, only use DELETE
      // when the bot's current permissions leave Discord enforcing ownership.
      if (!message) await requireOwnMessageDeletionOnly(env, link, channel, bot.id);
      const result = await discordRequest<DiscordMessageDeleteResult>(env,
        `/channels/${link.channelId}/messages/${link.messageId}`, "message_delete");
      return json(result);
    }
    if (!message) throw new Error("Missing preview message");
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

async function requireOwnMessageDeletionOnly(env: Env, link: MessageLink, channel: DiscordPermissionChannel, botId: string): Promise<void> {
  const blocked = () => new MessageAdminError(
    "The bot cannot read this message, and its permissions do not safely restrict deletion to its own messages. Enable Read Message History so ownership can be checked, then try again.",
    403, "DISCORD_OWNERSHIP_UNVERIFIED");
  let permissionChannel = channel;
  if ([10, 11, 12].includes(channel.type ?? -1)) {
    // Threads inherit channel permissions from their parent, not their category.
    if (!channel.parent_id || !/^\d{5,32}$/.test(channel.parent_id)) throw blocked();
    permissionChannel = await discordRequest<DiscordPermissionChannel>(env, `/channels/${channel.parent_id}`, "parent_channel");
    if (permissionChannel.id !== channel.parent_id || permissionChannel.guild_id !== link.guildId) throw blocked();
  }
  const [guild, member] = await Promise.all([
    discordRequest<DiscordPermissionGuild>(env, `/guilds/${link.guildId}`, "guild_permissions"),
    discordRequest<DiscordPermissionMember>(env, `/guilds/${link.guildId}/members/${botId}`, "bot_membership"),
  ]);
  if (guild?.id !== link.guildId || canDeleteOtherDiscordMessages(guild, member, permissionChannel, botId) !== false) throw blocked();
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
  const step = { channel_lookup: "channel lookup", bot_identity: "bot identity check", message_lookup: "message lookup", message_delete: "message deletion",
    guild_permissions: "server permissions check", bot_membership: "bot roles check", parent_channel: "thread parent permissions check" }[operation];
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
      "Discord refused to delete this message. It must belong to this bot, and the bot must have access to its channel or thread.", "DISCORD_MESSAGE_DELETE_DENIED");
    if (operation === "guild_permissions" || operation === "bot_membership" || operation === "parent_channel") return failure(
      "The bot cannot check its deletion permissions. Enable Read Message History in the linked channel so message ownership can be checked.", "DISCORD_PERMISSION_CHECK_DENIED");
    return failure("Discord denied the bot identity check. Check the deployed bot configuration.", "DISCORD_BOT_IDENTITY_DENIED");
  }
  if (status === 403) return failure(
    "Discord rejected the request without a channel-permission error. This may be a request or network-level rejection.", "DISCORD_REQUEST_REJECTED", 502);
  return failure("Discord could not complete the request. Please try again.", "DISCORD_REQUEST_FAILED", 502);
}
