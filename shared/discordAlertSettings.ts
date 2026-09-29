import type { DiscordAlertKey, DiscordAlertRouteKey } from "./discordAlertCatalog";
import type { LegacyDiscordAlertSettings } from "./discordAlertSettingsCompatibility";

export type DiscordAlertSetting<Key extends DiscordAlertKey = DiscordAlertKey> = {
  key: Key;
  name: string;
  enabled: boolean;
  configurable: boolean;
};

export type DiscordAlertSettingsMap = Partial<Record<DiscordAlertKey, DiscordAlertSetting>>;

export type DiscordAlertRouteSummary = {
  alert_key: DiscordAlertRouteKey;
  channel_id: string;
  channel_name?: string | null;
  thread_id: string | null;
  thread_name?: string | null;
  target_id: string;
  updated_by_discord_id: string | null;
  updated_at: number;
};

// Optional map supports a new dashboard during a rolling Worker deployment.
export type AdminDiscordAlertSettingsResponse = Partial<LegacyDiscordAlertSettings> & {
  ok: boolean;
  settings_by_key?: DiscordAlertSettingsMap;
  routes: Record<string, DiscordAlertRouteSummary | null>;
};
