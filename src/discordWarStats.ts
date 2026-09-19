import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { DISCORD_COMMAND_NAMES } from "./discordCommands";
import type { DiscordInteraction, DiscordInteractionResponse } from "./discordInteractions";
import { assertExternalResponseOk, ExternalApiError, fetchExternal } from "./external/http";
import type { Env } from "./types";
import { refreshWarMemberRespect, WarStatsRebuildLeaseError } from "./warStats";

export function isWarMeInteraction(interaction: DiscordInteraction): boolean {
  return interaction.type === 2 && interaction.data?.name === DISCORD_COMMAND_NAMES.war &&
    interaction.data.options?.[0]?.type === 1 && interaction.data.options[0].name === "me";
}

export async function warMeResponse(interaction: DiscordInteraction, env: Env): Promise<DiscordInteractionResponse> {
  const userId = interaction.member?.user?.id;
  if (!env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID || !userId) {
    return privateReply({ content: "Use `/war me` in the faction Discord server." });
  }

  try {
    const member = await env.DB.prepare(`
      SELECT links.torn_user_id
      FROM discord_member_links links
      JOIN home_faction_members members ON members.member_id = links.torn_user_id
      WHERE links.discord_user_id = ? AND members.is_current = 1 AND members.faction_id = ?
      LIMIT 1
    `).bind(userId, HOME_FACTION_ID).first<{ torn_user_id: number }>();
    if (!member) {
      return privateReply({ content: "No current faction member is linked to your Discord account. Check your Torn Discord link and ask an admin to refresh member links if needed." });
    }

    const war = await env.DB.prepare(`
      SELECT w.id, w.name
      FROM wars w
      JOIN sync_state s ON s.active_war_id = w.id
      WHERE s.name = ? AND s.war_state = 'current' AND w.status = 'active'
        AND w.practical_finish_time IS NULL AND w.finalized_at IS NULL
      LIMIT 1
    `).bind(SOURCE_NAME).first<{ id: number; name: string }>();
    if (!war) return privateReply({ content: "There is no ongoing war being tracked right now." });

    const components = warPageButton(env, war.name);
    const refresh = await refreshWarMemberRespect(env, war, member.torn_user_id);
    if (refresh.status === "cooldown") {
      return privateReply({
        content: `Please wait ${refresh.retry_after_seconds} seconds before refreshing your war stats again.`,
        components,
      });
    }
    const stats = refresh.member;
    if (!stats) {
      return privateReply({ content: `No war stats have been recorded for you in **${escapeDiscord(war.name)}** yet.`, components });
    }

    return privateReply({
      embeds: [{
        title: "Your war stats",
        description: `**${escapeDiscord(war.name)}**\nBased on the latest stored attacks. Respect refreshed <t:${refresh.recalculated_at}:R>.`,
        color: 0x2f80ed,
        fields: [
          { name: "Successful attacks", value: formatNumber(stats.attacks_vs_enemy_successful, 0), inline: true },
          { name: "Adjusted respect gained", value: formatNumber(stats.respect_gained, 2), inline: true },
          { name: "Raw respect gained", value: formatNumber(stats.respect_gained_raw, 2), inline: true },
        ],
      }],
      components,
    });
  } catch (error) {
    if (error instanceof WarStatsRebuildLeaseError) {
      return privateReply({ content: "War stats are being rebuilt. Please try `/war me` again in 30 seconds." });
    }
    console.error("Discord war stats failed", error instanceof Error ? error.message : "Unknown error");
    return privateReply({ content: "Your war stats are temporarily unavailable. Please try again shortly." });
  }
}

// The initial response is private and deferred; edit that reply after recalculation.
// https://docs.discord.com/developers/interactions/receiving-and-responding
export async function completeDeferredWarMeInteraction(interaction: DiscordInteraction, env: Env): Promise<void> {
  const response = await warMeResponse(interaction, env);
  const { flags: _flags, ...data } = response.data ?? {};
  try {
    const result = await fetchExternal(
      `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
      { timeoutMs: 10_000 },
    );
    await assertExternalResponseOk(result, "Discord interaction");
  } catch (error) {
    // Interaction tokens appear in the URL; never log transport errors verbatim.
    console.error("Unable to complete war stats reply", error instanceof ExternalApiError ? error.status : "transport error");
  }
}

function privateReply(data: NonNullable<DiscordInteractionResponse["data"]>): DiscordInteractionResponse {
  return { type: 4, data: { ...data, flags: 64, allowed_mentions: { parse: [] } } };
}

function warPageButton(env: Env, warName: string): NonNullable<DiscordInteractionResponse["data"]>["components"] {
  const base = (env.DASHBOARD_BASE_URL?.trim() || "https://buttgrass.pages.dev").replace(/\/+$/, "");
  return [{ type: 1, components: [{ type: 2, style: 5, label: "View war details", url: `${base}/wars/${encodeURIComponent(warName)}` }] }];
}

function formatNumber(value: unknown, decimals: number): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString("en-GB", { maximumFractionDigits: decimals }) : "Unknown";
}

function escapeDiscord(value: string): string {
  return value.slice(0, 250).replace(/[\\`*_~|>\[\]()]/g, "\\$&").replace(/@/g, "@\u200b");
}
