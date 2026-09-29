import { DISCORD_ALERT_KEYS, discordAlertByKey, type DiscordAlertKey } from "./discordAlertCatalog";
import type { AdminDiscordAlertSettingsResponse, DiscordAlertSetting, DiscordAlertSettingsMap } from "./discordAlertSettings";

// Wire compatibility only. New configuration and UI code use settings_by_key.
const LEGACY_SETTING_FIELDS = {
  chain_watch_alert: DISCORD_ALERT_KEYS.chainWatch,
  chain_watch_missed_check_in_alert: DISCORD_ALERT_KEYS.chainWatchMissedCheckIn,
  retaliation_board_alert: DISCORD_ALERT_KEYS.retaliationBoard,
  enemy_push_alert: DISCORD_ALERT_KEYS.enemyPush,
  enemy_scouting_report_alert: DISCORD_ALERT_KEYS.enemyScoutingReport,
  xanax_competition_alert: DISCORD_ALERT_KEYS.xanaxCompetition,
  termed_war_auto_end_alert: DISCORD_ALERT_KEYS.termedWarAutoEnd,
} as const;

export const LEGACY_DELIVERY_KEYS = [
  DISCORD_ALERT_KEYS.itemStockLow,
  DISCORD_ALERT_KEYS.chainWatchWarning,
  DISCORD_ALERT_KEYS.chainWatchCritical,
  DISCORD_ALERT_KEYS.chainWatchDrop,
  DISCORD_ALERT_KEYS.chainWatchUnfilledSlot,
  DISCORD_ALERT_KEYS.targetTravelTracker,
  DISCORD_ALERT_KEYS.homeTravelTracker,
] as const;

const LEGACY_SHOP_KEYS = {
  big_als: DISCORD_ALERT_KEYS.bigAlsShoplifting,
  jewelry_store: DISCORD_ALERT_KEYS.jewelryStoreShoplifting,
} as const;
type LegacyShopKey = keyof typeof LEGACY_SHOP_KEYS;
type LegacyShopSetting = { shop_key: LegacyShopKey; shop_name: string; enabled: boolean; configurable: boolean };
export type LegacyDiscordAlertSettings = Record<keyof typeof LEGACY_SETTING_FIELDS, DiscordAlertSetting> & {
  delivery_alerts: DiscordAlertSetting[];
  alerts: LegacyShopSetting[];
};

export function legacyShopAlertKey(value: unknown): DiscordAlertKey | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_SHOP_KEYS, value)
    ? LEGACY_SHOP_KEYS[value as LegacyShopKey] : null;
}

export function legacyDiscordAlertSettings(settings: Record<DiscordAlertKey, DiscordAlertSetting>): LegacyDiscordAlertSettings {
  return {
    ...Object.fromEntries(Object.entries(LEGACY_SETTING_FIELDS).map(([field, key]) => [field, settings[key]])),
    delivery_alerts: LEGACY_DELIVERY_KEYS.map(key => settings[key]),
    alerts: Object.entries(LEGACY_SHOP_KEYS).map(([shop_key, key]) => ({
      shop_key: shop_key as LegacyShopKey,
      shop_name: discordAlertByKey(key)!.admin.label,
      enabled: settings[key].enabled,
      configurable: settings[key].configurable,
    })),
  } as LegacyDiscordAlertSettings;
}

export function discordAlertSettingsFromResponse(response: AdminDiscordAlertSettingsResponse): DiscordAlertSettingsMap {
  // An explicitly partial new map stays partial: never fill missing state with defaults.
  if (response.settings_by_key !== undefined) return response.settings_by_key;
  const settings: DiscordAlertSettingsMap = {};
  for (const [field, key] of Object.entries(LEGACY_SETTING_FIELDS)) {
    const setting = response[field as keyof typeof LEGACY_SETTING_FIELDS];
    if (setting) settings[key] = setting;
  }
  for (const setting of response.delivery_alerts ?? []) settings[setting.key] = setting;
  for (const setting of response.alerts ?? []) {
    const key = legacyShopAlertKey(setting.shop_key);
    if (key) settings[key] = {
      key, name: discordAlertByKey(key)!.admin.label, enabled: setting.enabled, configurable: setting.configurable,
    };
  }
  return settings;
}
