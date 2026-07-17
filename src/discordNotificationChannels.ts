import { DISCORD_ALERTS, type DiscordAlertKey } from "./discordAlerts";
import type { Env } from "./types";

export type DiscordNotificationChannel = {
  guildId: string;
  alertKey: DiscordAlertKey;
  alertName: string;
  alertDescription: string;
  channelId: string;
  threadId: string | null;
  enabled: boolean;
  updatedByDiscordId: string | null;
  updatedAt: number;
};

type DiscordNotificationChannelRow = {
  guild_id: string;
  alert_key: string;
  channel_id: string;
  thread_id: string | null;
  enabled: number;
  updated_by_discord_id: string | null;
  updated_at: number;
};

export async function listDiscordNotificationChannels(
  env: Env,
  guildId: string,
): Promise<DiscordNotificationChannel[]> {
  const result = await env.DB.prepare(
    `
    SELECT guild_id, alert_key, channel_id, thread_id, enabled, updated_by_discord_id, updated_at
    FROM discord_notification_channels
    WHERE guild_id = ?
    ORDER BY alert_key
    `,
  )
    .bind(guildId)
    .all<DiscordNotificationChannelRow>();

  const rowsByAlertKey = new Map((result.results ?? []).map((row) => [row.alert_key, row]));
  return DISCORD_ALERTS
    .map((alert) => rowsByAlertKey.get(alert.key))
    .filter((row): row is DiscordNotificationChannelRow => Boolean(row))
    .map(discordNotificationChannelFromRow);
}

export async function readDiscordNotificationChannel(
  env: Env,
  guildId: string,
  alertKey: DiscordAlertKey,
): Promise<DiscordNotificationChannel | null> {
  const row = await env.DB.prepare(
    `
    SELECT guild_id, alert_key, channel_id, thread_id, enabled, updated_by_discord_id, updated_at
    FROM discord_notification_channels
    WHERE guild_id = ?
      AND alert_key = ?
      AND enabled = 1
    LIMIT 1
    `,
  )
    .bind(guildId, alertKey)
    .first<DiscordNotificationChannelRow>();

  return row ? discordNotificationChannelFromRow(row) : null;
}

export async function readDefaultDiscordNotificationChannel(
  env: Env,
  alertKey: DiscordAlertKey,
): Promise<DiscordNotificationChannel | null> {
  const row = await env.DB.prepare(
    `
    SELECT guild_id, alert_key, channel_id, thread_id, enabled, updated_by_discord_id, updated_at
    FROM discord_notification_channels
    WHERE alert_key = ?
      AND enabled = 1
    ORDER BY updated_at DESC, guild_id
    LIMIT 1
    `,
  )
    .bind(alertKey)
    .first<DiscordNotificationChannelRow>();

  return row ? discordNotificationChannelFromRow(row) : null;
}

export async function setDiscordNotificationChannel(
  env: Env,
  options: {
    guildId: string;
    alertKey: DiscordAlertKey;
    channelId: string;
    threadId?: string | null;
    updatedByDiscordId: string;
  },
): Promise<DiscordNotificationChannel> {
  await env.DB.prepare(
    `
    INSERT INTO discord_notification_channels (
      guild_id,
      alert_key,
      channel_id,
      thread_id,
      enabled,
      updated_by_discord_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 1, ?, unixepoch(), unixepoch())
    ON CONFLICT(guild_id, alert_key) DO UPDATE SET
      channel_id = excluded.channel_id,
      thread_id = excluded.thread_id,
      enabled = 1,
      updated_by_discord_id = excluded.updated_by_discord_id,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      options.guildId,
      options.alertKey,
      options.channelId,
      options.threadId ?? null,
      options.updatedByDiscordId,
    )
    .run();

  const saved = await readDiscordNotificationChannel(env, options.guildId, options.alertKey);
  if (!saved) {
    throw new Error("Discord notification channel was not saved");
  }
  return saved;
}

export async function unsetDiscordNotificationChannel(
  env: Env,
  guildId: string,
  alertKey: DiscordAlertKey,
): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM discord_notification_channels
    WHERE guild_id = ?
      AND alert_key = ?
    `,
  )
    .bind(guildId, alertKey)
    .run();
}

function discordNotificationChannelFromRow(row: DiscordNotificationChannelRow): DiscordNotificationChannel {
  const alert = DISCORD_ALERTS.find((item) => item.key === row.alert_key);
  if (!alert) {
    throw new Error(`Unknown Discord alert route: ${row.alert_key}`);
  }

  return {
    guildId: row.guild_id,
    alertKey: alert.key,
    alertName: alert.name,
    alertDescription: alert.description,
    channelId: row.channel_id,
    threadId: row.thread_id,
    enabled: row.enabled === 1,
    updatedByDiscordId: row.updated_by_discord_id,
    updatedAt: row.updated_at,
  };
}
