import type { AdminDiscordSubscriptionSettingsResponse, DiscordAlertSubscriber, UpdateDiscordSubscriptionSettingResponse } from "../shared/discordSubscriptionSettings";
import { readJsonObject } from "./backend/request";
import { DISCORD_ALERTS, discordAlertByKey, type DiscordAlertKey } from "./discordAlerts";
import type { Env } from "./types";
import { json } from "./utils";

export async function readDiscordSubscriptionAvailability(env: Env): Promise<Map<DiscordAlertKey, boolean>> {
  const rows = await env.DB.prepare("SELECT alert_key, subscribable FROM discord_alert_subscription_settings")
    .bind().all<{ alert_key: string; subscribable: number }>();
  const settings = new Map<DiscordAlertKey, boolean>(DISCORD_ALERTS.map(alert => [alert.key, alert.subscribable]));
  for (const row of rows.results ?? []) {
    const alert = discordAlertByKey(row.alert_key);
    if (alert) settings.set(alert.key, row.subscribable === 1);
  }
  return settings;
}

export async function readSubscribableDiscordAlerts(env: Env) {
  const settings = await readDiscordSubscriptionAvailability(env);
  return DISCORD_ALERTS.filter(alert => settings.get(alert.key));
}

async function adminSettings(env: Env): Promise<AdminDiscordSubscriptionSettingsResponse> {
  const availability = await readDiscordSubscriptionAvailability(env);
  const subscriptions = await env.DB.prepare(`SELECT subscriptions.alert_key, subscriptions.torn_user_id,
      COALESCE(NULLIF(TRIM(members.name), ''), 'Torn user ' || subscriptions.torn_user_id) AS name
    FROM discord_member_alert_subscriptions AS subscriptions
    LEFT JOIN home_faction_members AS members ON members.member_id = subscriptions.torn_user_id
    WHERE subscriptions.enabled = 1
    ORDER BY subscriptions.alert_key, name COLLATE NOCASE, subscriptions.torn_user_id`)
    .bind().all<DiscordAlertSubscriber & { alert_key: string }>();
  const byKey = new Map<string, DiscordAlertSubscriber[]>(DISCORD_ALERTS.map(alert => [alert.key, []]));
  for (const row of subscriptions.results ?? []) {
    byKey.get(row.alert_key)?.push({ torn_user_id: row.torn_user_id, name: row.name });
  }
  return { ok: true, alerts: Object.fromEntries(DISCORD_ALERTS.map(alert => [alert.key, {
    subscribable: availability.get(alert.key) === true,
    subscriber_count: byKey.get(alert.key)!.length,
    subscribers: byKey.get(alert.key)!,
  }])) };
}

export async function getAdminDiscordSubscriptionSettings(env: Env): Promise<Response> {
  return json(await adminSettings(env));
}

export async function updateAdminDiscordSubscriptionSettingFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const alert = typeof body.alert_key === "string" ? discordAlertByKey(body.alert_key) : null;
  if (!alert || typeof body.subscribable !== "boolean") {
    return json({ ok: false, error: "Choose a valid alert and subscription setting." }, 400);
  }
  await env.DB.prepare(`INSERT INTO discord_alert_subscription_settings (alert_key, subscribable, updated_at)
    VALUES (?, ?, unixepoch()) ON CONFLICT(alert_key) DO UPDATE SET
    subscribable = excluded.subscribable, updated_at = excluded.updated_at`)
    .bind(alert.key, body.subscribable ? 1 : 0).run();
  const settings = await adminSettings(env);
  return json({ ok: true, alert_key: alert.key, setting: settings.alerts[alert.key] } satisfies UpdateDiscordSubscriptionSettingResponse);
}
