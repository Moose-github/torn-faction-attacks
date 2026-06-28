export const DISCORD_ALERT_KEYS = {
  chainWatch: "chain_watch",
  enemyPush: "enemy_push",
  shopliftingSecurity: <ShopKey extends string>(shopKey: ShopKey): `shoplifting_security_alert:${ShopKey}` =>
    `shoplifting_security_alert:${shopKey}`,
} as const;

export const DISCORD_ALERTS = [
  {
    key: DISCORD_ALERT_KEYS.chainWatch,
    name: "Chain watch",
    description: "Warnings when a qualifying chain is close to dropping.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.enemyPush,
    name: "Enemy push",
    description: "Warnings when enemy push pressure reaches likely or underway.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.shopliftingSecurity("big_als"),
    name: "Big Als shoplifting",
    description: "Warnings when Big Als shoplifting security is down.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.shopliftingSecurity("jewelry_store"),
    name: "Jewelry Store shoplifting",
    description: "Warnings when Jewelry Store shoplifting security is down.",
    subscribable: true,
  },
] as const;

export type DiscordAlertKey = typeof DISCORD_ALERTS[number]["key"];

export function isDiscordAlertKey(value: string): value is DiscordAlertKey {
  return DISCORD_ALERTS.some((alert) => alert.key === value);
}

export function discordAlertByKey(key: string): typeof DISCORD_ALERTS[number] | null {
  return DISCORD_ALERTS.find((alert) => alert.key === key) ?? null;
}
