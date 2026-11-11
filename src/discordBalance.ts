import { isRecord } from "./backend/request";
import { HOME_FACTION_ID, TORN_FACTION_API_BASE_URL } from "./constants";
import { DISCORD_COMMAND_NAMES } from "./discordCommands";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { assertExternalResponseOk, ExternalApiError, fetchExternal } from "./external/http";
import { fetchTrackedTornJson } from "./external/torn";
import type { Env } from "./types";

const UNAVAILABLE_MESSAGE = "Your faction money balance is temporarily unavailable. Please try again shortly.";

export function isBalanceInteraction(interaction: DiscordInteraction): boolean {
  return interaction.type === 2 && interaction.data?.name === DISCORD_COMMAND_NAMES.balance;
}

export async function balanceResponse(interaction: DiscordInteraction, env: Env): Promise<DiscordInteractionResponse> {
  const userId = interaction.member?.user?.id;
  if (!env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID || !userId) {
    return privateReply("Use `/bal` in the faction Discord server.");
  }

  try {
    // Resolve only the signed interaction's caller, never a supplied player ID.
    const { results: members } = await env.DB.prepare(`
      SELECT links.torn_user_id
      FROM discord_member_links links
      JOIN home_faction_members members ON members.member_id = links.torn_user_id
      WHERE links.discord_user_id = ? AND members.is_current = 1 AND members.faction_id = ?
      LIMIT 2
    `).bind(userId, HOME_FACTION_ID).all<{ torn_user_id: number }>();
    if (members?.length !== 1) {
      return privateReply("Your Discord account could not be matched to a current faction member. Check your Torn Discord link and ask an admin to refresh member links if needed.");
    }

    // This endpoint requires the faction's server key, not a pooled player key.
    const key = (typeof env.TORN_API_KEY === "string" ? env.TORN_API_KEY : await env.TORN_API_KEY?.get())?.trim();
    if (!key) return privateReply(UNAVAILABLE_MESSAGE);

    const data = await fetchTrackedTornJson<unknown>(
      env,
      `${TORN_FACTION_API_BASE_URL}/balance?cat=current`,
      { method: "GET", headers: { Accept: "application/json", Authorization: `ApiKey ${key}` } },
      { feature: "discord-balance", keySource: "env:TORN_API_KEY", timeoutMs: 10_000 },
    );
    if (!isRecord(data) || !isRecord(data.balance) || !Array.isArray(data.balance.members)) {
      return privateReply(UNAVAILABLE_MESSAGE);
    }

    const balances = data.balance.members.filter((entry: unknown) =>
      isRecord(entry) && entry.id === members[0].torn_user_id,
    );
    if (balances.length === 0) {
      return privateReply("No current faction money balance was found for your linked Torn account.");
    }
    if (balances.length !== 1 || typeof balances[0].money !== "number" || !Number.isSafeInteger(balances[0].money)) {
      return privateReply(UNAVAILABLE_MESSAGE);
    }

    // Send only the caller's money; never forward the faction/member payload.
    return privateReply(balances[0].money.toLocaleString("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }));
  } catch (error) {
    // Upstream errors can contain private response data. Log only their status.
    console.error("Discord balance lookup failed", error instanceof ExternalApiError ? error.status : "request error");
    return privateReply(UNAVAILABLE_MESSAGE);
  }
}

export async function completeDeferredBalanceInteraction(interaction: DiscordInteraction, env: Env): Promise<void> {
  const response = await balanceResponse(interaction, env);
  const { flags: _flags, ...data } = response.data ?? {};
  try {
    // Editing the original reply preserves its initial ephemeral flag.
    const result = await fetchExternal(
      `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
      { timeoutMs: 10_000 },
    );
    await assertExternalResponseOk(result, "Discord interaction");
  } catch (error) {
    // Transport errors can include the interaction token in the URL.
    console.error("Unable to complete balance reply", error instanceof ExternalApiError ? error.status : "transport error");
  }
}

function privateReply(content: string): DiscordInteractionResponse {
  return { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } };
}
