import { DISCORD_ADMIN_ALERTS, DISCORD_DEFAULT_ALERT_ROUTE_KEY, type DiscordAlertKey } from "../../../../shared/discordAlertCatalog";
import type { DiscordAlertSettingsMap } from "../../../../shared/discordAlertSettings";

export type DiscordAlertDisplayRow = {
  key: string;
  label: string;
  description: string;
} & ({ kind: "status"; statusLabel: string } | {
  kind: "alert";
  checked: boolean;
  configurable: boolean;
  onChange: (enabled: boolean) => void;
});

export function discordAlertRows(
  settings: DiscordAlertSettingsMap,
  loading: boolean,
  onChange: (key: DiscordAlertKey, enabled: boolean) => void,
): DiscordAlertDisplayRow[] {
  return [
    {
      kind: "status", key: DISCORD_DEFAULT_ALERT_ROUTE_KEY, label: "Default fallback",
      description: "Fallback bot channel used when an alert does not have its own route.", statusLabel: "Fallback",
    },
    ...DISCORD_ADMIN_ALERTS.map((alert): DiscordAlertDisplayRow => {
      const setting = settings[alert.key];
      const copy = { key: alert.key, label: alert.admin.label, description: alert.admin.description };
      return setting ? {
        ...copy, kind: "alert", checked: setting.enabled, configurable: setting.configurable,
        onChange: enabled => onChange(alert.key, enabled),
      } : { ...copy, kind: "status", statusLabel: loading ? "Loading" : "Unavailable" };
    }),
  ];
}

export function discordAlertStatus(settings: DiscordAlertSettingsMap, loading: boolean): string {
  if (loading) return "Loading";
  const available = DISCORD_ADMIN_ALERTS.flatMap(alert => settings[alert.key] ? [settings[alert.key]!] : []);
  return available.length ? `${available.filter(setting => setting.enabled).length}/${available.length} active` : "Unavailable";
}
