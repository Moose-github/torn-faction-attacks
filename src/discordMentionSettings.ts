import type { AdminDiscordAlertMentionsResponse, DiscordAlertMentionSetting, DiscordMentionRole, UpdateDiscordAlertMentionsResponse } from "../shared/discordAlertMentions";
import { readJsonObject } from "./backend/request";
import { DISCORD_ALERTS, isDiscordAlertKey } from "./discordAlerts";
import { fetchExternal } from "./external/http";
import type { Env } from "./types";
import { json } from "./utils";

const MAX_ALERT_ROLES = 20;
class RoleListError extends Error {}
const emptyMentions = (): DiscordAlertMentionSetting => ({ role_ids: [], everyone: false, here: false });

export async function getAdminDiscordAlertMentions(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`SELECT alert_key, subscription_type, discord_id
    FROM discord_admin_alert_subscriptions WHERE enabled = 1 ORDER BY discord_id`)
    .all<{ alert_key: string; subscription_type: string; discord_id: string }>();
  const alerts = Object.fromEntries(DISCORD_ALERTS.map(alert => [alert.key, emptyMentions()]));
  for (const row of rows.results ?? []) {
    if (!isDiscordAlertKey(row.alert_key)) continue;
    const setting = alerts[row.alert_key];
    if (row.subscription_type === "role") setting.role_ids.push(row.discord_id);
    if (row.subscription_type === "everyone") setting.everyone = true;
    if (row.subscription_type === "here") setting.here = true;
  }
  let roles: DiscordMentionRole[] = [], rolesError: string | null = null;
  try { roles = await readGuildRoles(env); }
  catch (error) { rolesError = error instanceof Error ? error.message : "Unable to load Discord roles."; }
  return json({ ok: true, alerts, roles, roles_error: rolesError } satisfies AdminDiscordAlertMentionsResponse);
}

export async function updateAdminDiscordAlertMentionsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  if (typeof body.alert_key !== "string" || !isDiscordAlertKey(body.alert_key)) {
    return json({ ok: false, error: "Choose a valid alert." }, 400);
  }
  if (!Array.isArray(body.role_ids) || body.role_ids.length > MAX_ALERT_ROLES ||
      body.role_ids.some(id => typeof id !== "string" || !/^\d{5,32}$/.test(id)) ||
      typeof body.everyone !== "boolean" || typeof body.here !== "boolean") {
    return json({ ok: false, error: `Choose up to ${MAX_ALERT_ROLES} roles and valid mention options.` }, 400);
  }
  const mentions: DiscordAlertMentionSetting = {
    role_ids: [...new Set(body.role_ids as string[])], everyone: body.everyone, here: body.here,
  };
  if (mentions.role_ids.length) {
    let roles: DiscordMentionRole[];
    try { roles = await readGuildRoles(env); }
    catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Unable to load Discord roles." }, 502); }
    if (mentions.role_ids.some(id => !roles.some(role => role.id === id))) {
      return json({ ok: false, error: "A selected role no longer exists in the faction server. Refresh the roles and try again." }, 400);
    }
  }
  // D1 batches are atomic. Only replace this alert's role/broadcast settings;
  // administrator user mentions and personal subscriptions remain independent.
  const statements = [env.DB.prepare(`DELETE FROM discord_admin_alert_subscriptions
    WHERE alert_key = ? AND subscription_type IN ('role', 'everyone', 'here')`).bind(body.alert_key)];
  const entries = mentions.role_ids.map(id => ({ type: "role", id }));
  if (mentions.everyone) entries.push({ type: "everyone", id: "everyone" });
  if (mentions.here) entries.push({ type: "here", id: "here" });
  for (const entry of entries) statements.push(env.DB.prepare(`INSERT INTO discord_admin_alert_subscriptions
    (alert_key, subscription_type, discord_id, enabled) VALUES (?, ?, ?, 1)`).bind(body.alert_key, entry.type, entry.id));
  await env.DB.batch(statements);
  return json({ ok: true, alert_key: body.alert_key, mentions } satisfies UpdateDiscordAlertMentionsResponse);
}

async function readGuildRoles(env: Env): Promise<DiscordMentionRole[]> {
  const guildId = env.DISCORD_GUILD_ID?.trim(), token = env.DISCORD_BOT_TOKEN?.trim();
  if (!guildId || !/^\d{5,32}$/.test(guildId) || !token) throw new Error("The faction Discord bot is not configured.");
  try {
    const response = await fetchExternal(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${token}` },
    }, { timeoutMs: 10_000 });
    if (response.status === 429) throw new RoleListError("Discord is rate limiting role requests. Please try again shortly.");
    if (!response.ok) throw new RoleListError("Unable to load roles from the faction Discord server. Check the bot's access.");
    const roles = await response.json<Array<{ id: string; name: string; position: number }>>();
    if (!Array.isArray(roles)) throw new RoleListError("Discord returned an invalid role list.");
    return roles.filter(role => /^\d{5,32}$/.test(role.id) && role.id !== guildId && typeof role.name === "string")
      .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
      .map(role => ({ id: role.id, name: role.name }));
  } catch (error) {
    if (error instanceof RoleListError) throw error;
    throw new Error("Unable to reach Discord to load roles. Please try again.");
  }
}
