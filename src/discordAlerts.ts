export const DISCORD_ALERT_KEYS = {
  chainWatch: "chain_watch",
  chainWatchWarning: "chain_watch_warning",
  chainWatchCritical: "chain_watch_critical",
  chainWatchDrop: "chain_watch_drop",
  retaliationBoard: "retaliation_board",
  enemyPush: "enemy_push",
  targetTravelTracker: "target_travel_tracker",
  homeTravelTracker: "home_travel_tracker",
  enemyScoutingReport: "enemy_scouting_report",
  xanaxCompetition: "xanax_competition",
  termedWarAutoEnd: "termed_war_auto_end",
  shopliftingSecurity: <ShopKey extends string>(shopKey: ShopKey): `shoplifting_security_alert:${ShopKey}` =>
    `shoplifting_security_alert:${shopKey}`,
} as const;

export const DISCORD_ALERTS = [
  {
    key: DISCORD_ALERT_KEYS.chainWatch,
    name: "Chain watch",
    description: "Persistent Chain Watch status message updates.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchWarning,
    name: "Chain watch warning",
    description: "Mentions when a qualifying chain has 60 seconds remaining.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchCritical,
    name: "Chain watch critical",
    description: "Mentions when a qualifying chain has 30 seconds remaining.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchDrop,
    name: "Chain watch dropped",
    description: "Mentions when a qualifying chain has dropped.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.retaliationBoard,
    name: "Retaliation board",
    description: "Persistent retaliation opportunity board updates.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.enemyPush,
    name: "Enemy push",
    description: "Warnings when enemy push pressure reaches likely or underway.",
    subscribable: true,
  },
  {
    key: DISCORD_ALERT_KEYS.targetTravelTracker,
    name: "Target travel tracker",
    description: "Persistent target faction travel tracker updates.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.homeTravelTracker,
    name: "Home travel tracker",
    description: "Persistent home faction travel tracker updates.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.enemyScoutingReport,
    name: "Enemy scouting report",
    description: "War matchup scouting reports with stats images.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.xanaxCompetition,
    name: "Xanax competition",
    description: "Monthly Xanax competition reminder image.",
    subscribable: false,
  },
  {
    key: DISCORD_ALERT_KEYS.termedWarAutoEnd,
    name: "Termed war auto-end",
    description: "Notifications when a termed war score limit is reached.",
    subscribable: false,
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
