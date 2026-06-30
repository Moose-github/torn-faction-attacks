import { type DiscordAllowedMentions } from "./discord";
import { Env } from "./types";

type DiscordAlertMentionRow = {
  subscription_type: string;
  discord_id: string;
};

export type DiscordAlertMentions = {
  messageSuffix: string;
  allowedMentions: DiscordAllowedMentions | undefined;
};

export async function readDiscordAlertMentions(env: Env, alertKey: string): Promise<DiscordAlertMentions> {
  const adminResult = await env.DB.prepare(
    `
    SELECT subscription_type, discord_id
    FROM discord_admin_alert_subscriptions
    WHERE alert_key = ?
      AND enabled = 1
    ORDER BY subscription_type, discord_id
    `,
  )
    .bind(alertKey)
    .all<DiscordAlertMentionRow>();
  const memberResult = await env.DB.prepare(
    `
    SELECT 'user' AS subscription_type,
           links.discord_user_id AS discord_id
    FROM discord_member_alert_subscriptions subscriptions
    JOIN discord_member_links links
      ON links.torn_user_id = subscriptions.torn_user_id
    WHERE subscriptions.alert_key = ?
      AND subscriptions.enabled = 1
    ORDER BY links.discord_user_id
    `,
  )
    .bind(alertKey)
    .all<DiscordAlertMentionRow>();
  const rows = [
    ...(adminResult.results ?? []),
    ...(memberResult.results ?? []),
  ];
  const users = uniqueDiscordIds(rows, "user");
  const roles = uniqueDiscordIds(rows, "role");
  const messageSuffix = [
    ...users.map((id) => `<@${id}>`),
    ...roles.map((id) => `<@&${id}>`),
  ].join(" ");

  return {
    messageSuffix,
    allowedMentions: users.length > 0 || roles.length > 0
      ? {
          users,
          roles,
        }
      : undefined,
  };
}

export function formatDiscordAlertMessage(alertText: string, messageSuffix: string): string {
  return messageSuffix ? `${alertText}\n${messageSuffix}` : alertText;
}

function uniqueDiscordIds(rows: DiscordAlertMentionRow[], mentionType: "user" | "role"): string[] {
  return [...new Set(
    rows
      .filter((row) => row.subscription_type === mentionType)
      .map((row) => row.discord_id.trim())
      .filter((id) => /^\d{5,32}$/.test(id)),
  )];
}
