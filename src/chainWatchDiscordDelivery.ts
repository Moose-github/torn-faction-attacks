import type { DiscordAllowedMentions } from "./discord";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { DISCORD_ALERT_KEYS, type DiscordAlertKey } from "./discordAlerts";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import { deleteDiscordBotMessage, patchDiscordBotJson, postDiscordBotJsonAndRead } from "./external/discord";
import { ExternalApiError } from "./external/http";
import type { Env } from "./types";

type DeliveryResult<T> = { status: "success"; value: T } | { status: "failed"; error: Error };
export type WatchDeliveryResult<T, Reason extends string = "disabled" | "no_route" | "not_found"> = DeliveryResult<T> |
  { status: "skipped"; reason: Reason };

function failed(error: unknown): { status: "failed"; error: Error } {
  return { status: "failed", error: error instanceof Error ? error : new Error(String(error)) };
}

async function messageNonce(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return Array.from(digest.slice(0, 12), byte => byte.toString(16).padStart(2, "0")).join("");
}

// These functions perform Discord I/O only. Callers own leases, eligibility,
// persistence and retry policy, and must handle success, failure and skips.
export async function sendWatchDiscordMessage(
  env: Env, channelId: string, payload: Record<string, unknown>, nonceKey: string,
): Promise<DeliveryResult<string>> {
  try {
    if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured");
    const message = await postDiscordBotJsonAndRead<{ id: string }>(env.DISCORD_BOT_TOKEN, `/channels/${channelId}/messages`, {
      ...payload, nonce: await messageNonce(nonceKey), enforce_nonce: true,
    }, { timeoutMs: 10_000 });
    if (!message.id) throw new Error("Discord did not return a chain watch message ID");
    return { status: "success", value: message.id };
  } catch (error) { return failed(error); }
}

export async function editWatchDiscordMessage(
  env: Env, channelId: string, messageId: string, payload: Record<string, unknown>,
): Promise<WatchDeliveryResult<void, "not_found">> {
  try {
    if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured");
    await patchDiscordBotJson(env.DISCORD_BOT_TOKEN, `/channels/${channelId}/messages/${messageId}`, payload, { timeoutMs: 10_000 });
    return { status: "success", value: undefined };
  } catch (error) {
    return error instanceof ExternalApiError && error.status === 404
      ? { status: "skipped", reason: "not_found" } : failed(error);
  }
}

export async function deleteWatchDiscordMessage(env: Env, channelId: string, messageId: string): Promise<WatchDeliveryResult<void, "not_found">> {
  try {
    if (!env.DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is not configured");
    await deleteDiscordBotMessage(env.DISCORD_BOT_TOKEN, channelId, messageId, { timeoutMs: 10_000 });
    return { status: "success", value: undefined };
  } catch (error) {
    return error instanceof ExternalApiError && error.status === 404
      ? { status: "skipped", reason: "not_found" } : failed(error);
  }
}

export async function deliverChainWatchAlert(
  env: Env,
  existingMessageId: string | null,
  options: string | { message: string; allowedMentions?: DiscordAllowedMentions },
  cardColor?: number,
  alertKey: DiscordAlertKey = DISCORD_ALERT_KEYS.chainWatch,
): Promise<WatchDeliveryResult<string, "disabled" | "no_route">> {
  try {
    if (!await isDiscordAlertEnabled(env, alertKey)) return { status: "skipped", reason: "disabled" };
    // Stage alerts already include the configured mentions and assigned watcher.
    const mentions = typeof options === "string" ? await readDiscordAlertMentions(env, alertKey) : null;
    const message = typeof options === "string" ? formatDiscordAlertMessage(options, mentions!.messageSuffix) : options.message;
    const allowedMentions = typeof options === "string" ? mentions!.allowedMentions ?? { users: [], roles: [] } : options.allowedMentions;
    const messageId = await upsertDiscordAlertMessage(env, alertKey, existingMessageId, message, allowedMentions, { cardColor });
    return messageId ? { status: "success", value: messageId } : { status: "skipped", reason: "no_route" };
  } catch (error) { return failed(error); }
}
