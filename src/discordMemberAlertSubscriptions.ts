import { readJsonObject } from "./backend/request";
import { DISCORD_ALERTS, discordAlertByKey, type DiscordAlertKey } from "./discordAlerts";
import { Env } from "./types";
import { json } from "./utils";

type DiscordMemberLinkRow = {
  torn_user_id: number;
  discord_user_id: string;
};

type DiscordMemberAlertSubscriptionRow = {
  alert_key: string;
  enabled: number;
};

export type DiscordMemberAlertSubscriptionSetting = {
  key: DiscordAlertKey;
  name: string;
  description: string;
  enabled: boolean;
};

export type DiscordMemberAlertSubscriptionsResponse = {
  ok: true;
  discord_link: {
    torn_user_id: number;
    discord_user_id: string | null;
    linked: boolean;
  };
  alerts: DiscordMemberAlertSubscriptionSetting[];
};

export async function getDiscordMemberAlertSubscriptions(
  env: Env,
  tornUserId: number | null,
): Promise<Response> {
  if (!tornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  return json(await readDiscordMemberAlertSubscriptions(env, tornUserId));
}

export async function updateDiscordMemberAlertSubscriptionFromRequest(
  request: Request,
  env: Env,
  tornUserId: number | null,
): Promise<Response> {
  if (!tornUserId) {
    return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
  }

  const body = await readJsonObject(request);
  const alertKey = typeof body.alert_key === "string" ? body.alert_key : "";
  const result = await updateDiscordMemberAlertSubscription(env, tornUserId, alertKey, body.enabled);
  if (result === "unknown_alert") {
    return json({ ok: false, error: "Unknown subscribable alert", code: "UNKNOWN_ALERT" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return json({ ok: false, error: "enabled must be a boolean", code: "INVALID_ENABLED" }, 400);
  }
  if (result === "discord_not_linked") {
    return json({
      ok: false,
      error: "No Discord link is available for your Torn user yet",
      code: "DISCORD_NOT_LINKED",
    }, 400);
  }

  return json(await readDiscordMemberAlertSubscriptions(env, tornUserId));
}

export async function readDiscordMemberAlertSubscriptionsForDiscordUser(
  env: Env,
  discordUserId: string,
): Promise<DiscordMemberAlertSubscriptionsResponse | null> {
  const link = await readDiscordMemberLinkByDiscordUserId(env, discordUserId);
  if (!link) {
    return null;
  }

  return readDiscordMemberAlertSubscriptions(env, link.torn_user_id, link);
}

export async function updateDiscordMemberAlertSubscription(
  env: Env,
  tornUserId: number,
  alertKey: string,
  enabled: unknown,
): Promise<"ok" | "unknown_alert" | "invalid_enabled" | "discord_not_linked"> {
  const alert = discordAlertByKey(alertKey);
  if (!alert || !alert.subscribable) {
    return "unknown_alert";
  }
  if (typeof enabled !== "boolean") {
    return "invalid_enabled";
  }

  const link = await readDiscordMemberLink(env, tornUserId);
  if (enabled && !link) {
    return "discord_not_linked";
  }

  await env.DB.prepare(
    `
    INSERT INTO discord_member_alert_subscriptions (torn_user_id, alert_key, enabled, created_at, updated_at)
    VALUES (?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(torn_user_id, alert_key) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
    `,
  )
    .bind(tornUserId, alert.key, enabled ? 1 : 0)
    .run();

  return "ok";
}

export async function readDiscordMemberAlertSubscriptions(
  env: Env,
  tornUserId: number,
  knownLink?: DiscordMemberLinkRow,
): Promise<DiscordMemberAlertSubscriptionsResponse> {
  const link = knownLink ?? await readDiscordMemberLink(env, tornUserId);
  const subscriptions = await env.DB.prepare(
    `
    SELECT alert_key, enabled
    FROM discord_member_alert_subscriptions
    WHERE torn_user_id = ?
    `,
  )
    .bind(tornUserId)
    .all<DiscordMemberAlertSubscriptionRow>();
  const subscriptionByKey = new Map(
    (subscriptions.results ?? []).map((row) => [row.alert_key, row.enabled === 1]),
  );

  return {
    ok: true,
    discord_link: {
      torn_user_id: tornUserId,
      discord_user_id: link?.discord_user_id ?? null,
      linked: Boolean(link),
    },
    alerts: DISCORD_ALERTS
      .filter((alert) => alert.subscribable)
      .map<DiscordMemberAlertSubscriptionSetting>((alert) => ({
        key: alert.key,
        name: alert.name,
        description: alert.description,
        enabled: subscriptionByKey.get(alert.key) ?? false,
      })),
  };
}

async function readDiscordMemberLink(env: Env, tornUserId: number): Promise<DiscordMemberLinkRow | null> {
  return await env.DB.prepare(
    `
    SELECT torn_user_id, discord_user_id
    FROM discord_member_links
    WHERE torn_user_id = ?
    LIMIT 1
    `,
  )
    .bind(tornUserId)
    .first<DiscordMemberLinkRow>();
}

async function readDiscordMemberLinkByDiscordUserId(
  env: Env,
  discordUserId: string,
): Promise<DiscordMemberLinkRow | null> {
  return await env.DB.prepare(
    `
    SELECT torn_user_id, discord_user_id
    FROM discord_member_links
    WHERE discord_user_id = ?
    LIMIT 1
    `,
  )
    .bind(discordUserId)
    .first<DiscordMemberLinkRow>();
}
