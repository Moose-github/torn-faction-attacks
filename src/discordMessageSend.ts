import { DISCORD_CUSTOM_MESSAGE_MAX_LENGTH, type DiscordMessageSendResult } from "../shared/discordMessageAdmin";
import { readJsonObject } from "./backend/request";
import { createDiscordBotMessage } from "./discord";
import { requireDiscordDestination, RouteError } from "./discordRouteAdmin";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

export async function sendAdminDiscordMessageFromRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > DISCORD_CUSTOM_MESSAGE_MAX_LENGTH) {
      return json({ ok: false, error: `Enter a message between 1 and ${DISCORD_CUSTOM_MESSAGE_MAX_LENGTH} characters.`, code: "INVALID_MESSAGE" }, 400);
    }
    const { guildId, channel } = await requireDiscordDestination(env, body.channel_id);
    const messageId = await createDiscordBotMessage(env, channel.id, message);
    if (!messageId || !/^\d{5,32}$/.test(messageId)) {
      return json({ ok: false, error: "Discord did not confirm the message. Check the channel before trying again.", code: "DISCORD_SEND_UNCONFIRMED" }, 502);
    }
    return json({
      ok: true, channel_id: channel.id, message_id: messageId,
      message_link: `https://discord.com/channels/${guildId}/${channel.id}/${messageId}`,
    } satisfies DiscordMessageSendResult);
  } catch (error) {
    if (error instanceof RouteError) return json({ ok: false, error: error.message, code: "DISCORD_DESTINATION_ERROR" }, error.status);
    if (error instanceof ExternalApiError && error.status === 429) {
      return json({ ok: false, error: "Discord is rate limiting messages. Please wait before trying again.", code: "DISCORD_RATE_LIMITED" }, 429);
    }
    if (error instanceof ExternalApiError && (error.status === 403 || error.status === 404)) {
      return json({ ok: false, error: "The bot cannot send to this channel. Check its Discord permissions or choose another channel.", code: "DISCORD_SEND_DENIED" }, 403);
    }
    return json({ ok: false, error: "Unable to confirm delivery to Discord. Check the channel before trying again.", code: "DISCORD_SEND_FAILED" }, 502);
  }
}
