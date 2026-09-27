import type { ArmoryStack, ArmoryStockSetting } from "../shared/armory";
import { DISCORD_ALERT_KEYS } from "./discordAlerts";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { formatDiscordAlertMessage, readDiscordAlertMentions } from "./discordMentions";
import type { Env } from "./types";

export type StockSettings = Record<string, ArmoryStockSetting & { alerted: boolean }>;

export function medicalStockSettings(raw: string | undefined, items: ArmoryStack[]): StockSettings {
  const settings: StockSettings = JSON.parse(raw ?? "{}");
  for (const item of items) {
    settings[item.id] ??= { name: item.name, threshold: 0, enabled: true, alerted: false };
    settings[item.id].name = item.name;
  }
  return settings;
}

// Remember known models so an omitted available stack means zero, including all-loaned items.
export function medicalStockRows(items: ArmoryStack[], settings: StockSettings): ArmoryStack[] {
  const available = new Set(items.filter(item => !item.loaned).map(item => item.id));
  return [...items, ...Object.entries(settings).filter(([id]) => !available.has(Number(id)))
    .map(([id, setting]) => ({ id: Number(id), name: setting.name, type: "Medical", amount: 0, loaned: null }))]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id || (a.loaned?.id ?? 0) - (b.loaned?.id ?? 0));
}

export async function sendMedicalStockAlert(env: Env, name: string, amount: number, threshold: number): Promise<boolean> {
  const key = DISCORD_ALERT_KEYS.itemStockLow;
  if (!await isDiscordAlertEnabled(env, key)) return false;
  const mentions = await readDiscordAlertMentions(env, key);
  const safeName = name.replace(/[\\`*_~|<>@]/g, "").slice(0, 180);
  return !!await upsertDiscordAlertMessage(env, key, null, formatDiscordAlertMessage(
    `**Item stock low**\n${safeName}: **${amount.toLocaleString("en-GB")} available** (threshold: ${threshold.toLocaleString("en-GB")}).\nAvailable stock is at or below the threshold. Loaned items are excluded.`,
    mentions.messageSuffix,
  ), mentions.allowedMentions ?? { users: [], roles: [] });
}
