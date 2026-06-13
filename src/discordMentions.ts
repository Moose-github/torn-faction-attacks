import { type DiscordAllowedMentions } from "./discord";
import { Env } from "./types";

type DiscordAlertMentionRow = {
  mention_type: string;
  discord_id: string;
};

export type DiscordAlertMentions = {
  messageSuffix: string;
  allowedMentions: DiscordAllowedMentions | undefined;
};

export async function readDiscordAlertMentions(env: Env, alertKey: string): Promise<DiscordAlertMentions> {
  const result = await env.DB.prepare(
    `
    SELECT mention_type, discord_id
    FROM discord_alert_mentions
    WHERE alert_key = ?
      AND enabled = 1
    ORDER BY mention_type, discord_id
    `,
  )
    .bind(alertKey)
    .all<DiscordAlertMentionRow>();
  const rows = result.results ?? [];
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
      .filter((row) => row.mention_type === mentionType)
      .map((row) => row.discord_id.trim())
      .filter((id) => /^\d{5,32}$/.test(id)),
  )];
}
