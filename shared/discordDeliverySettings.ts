// Compatibility projection for the previous settings response.
import { discordAlertByKey } from "./discordAlertCatalog";
import { LEGACY_DELIVERY_KEYS } from "./discordAlertSettingsCompatibility";
import type { DiscordAlertSetting } from "./discordAlertSettings";

export const DISCORD_DELIVERY_CONTROLS = LEGACY_DELIVERY_KEYS.map(key => {
  const alert = discordAlertByKey(key)!;
  return { key, name: alert.admin.label, description: alert.admin.description };
});
export type DiscordDeliveryAlertKey = typeof LEGACY_DELIVERY_KEYS[number];
export type DiscordDeliveryAlertSetting = DiscordAlertSetting<DiscordDeliveryAlertKey>;
