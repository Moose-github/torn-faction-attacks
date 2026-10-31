import { accessRolesFromDiscord, type AccessRole } from "../shared/accessRoles";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";

/** Resolve only the authenticated Torn member's linked account in our server.
 * These assignments grant no permissions; Member/Admin authorization is separate.
 * Refresh on login and /auth/me, without adding Discord calls to every API request.
 */
export async function readDiscordAccessRoles(env: Env, tornUserId: number): Promise<AccessRole[]> {
  const guildId = env.DISCORD_GUILD_ID?.trim();
  const token = env.DISCORD_BOT_TOKEN?.trim();
  if (!guildId || !/^\d{5,32}$/.test(guildId) || !token) return [];

  try {
    const link = await env.DB.prepare(
      "SELECT discord_user_id FROM discord_member_links WHERE torn_user_id = ?",
    ).bind(tornUserId).first<{ discord_user_id: string }>();
    if (!link || !/^\d{5,32}$/.test(link.discord_user_id)) return [];

    const response = await fetchExternal(
      `https://discord.com/api/v10/guilds/${guildId}/members/${link.discord_user_id}`,
      { headers: { Authorization: `Bot ${token}` } },
      { timeoutMs: 10_000 },
    );
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Discord member lookup failed");
    const member = await response.json<{ roles?: unknown } | null>();
    if (!Array.isArray(member?.roles) || member.roles.some(role => typeof role !== "string")) {
      throw new Error("Invalid Discord member roles");
    }
    return accessRolesFromDiscord(member.roles);
  } catch {
    // Unverified assignments are omitted; a Discord outage must not block Torn login.
    // Do not log upstream errors, which may include credentials.
    console.warn("Unable to verify Discord access roles; returning no role assignments.");
    return [];
  }
}
