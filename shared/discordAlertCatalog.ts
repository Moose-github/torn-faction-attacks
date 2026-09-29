export const DISCORD_ALERT_KEYS = {
  chainWatch: "chain_watch",
  chainWatchWarning: "chain_watch_warning",
  chainWatchCritical: "chain_watch_critical",
  chainWatchDrop: "chain_watch_drop",
  chainWatchMissedCheckIn: "chain_watch_missed_check_in",
  chainWatchUnfilledSlot: "chain_watch_unfilled_slot",
  retaliationBoard: "retaliation_board",
  enemyPush: "enemy_push",
  targetTravelTracker: "target_travel_tracker",
  homeTravelTracker: "home_travel_tracker",
  enemyScoutingReport: "enemy_scouting_report",
  xanaxCompetition: "xanax_competition",
  termedWarAutoEnd: "termed_war_auto_end",
  itemStockLow: "item_stock_low",
  bigAlsShoplifting: "shoplifting_security_alert:big_als",
  jewelryStoreShoplifting: "shoplifting_security_alert:jewelry_store",
} as const;

// Keep this catalog append-only: Discord subscription menus encode stable positions.
// subscribable is the default; runtime admin overrides live in discord_alert_subscription_settings.
export const DISCORD_ALERTS = [
  {
    key: DISCORD_ALERT_KEYS.chainWatch,
    name: "Chain watch",
    description: "Persistent Chain Watch status message updates.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch alerts", description: "Controls the persistent Chain Watch status message. Warning, critical and dropped messages have their own switches below.", order: 0 },
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchWarning,
    name: "Chain watch warning",
    description: "Mentions when a qualifying chain has 60 seconds remaining.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch warning", description: "Sends a Discord warning when a qualifying chain has 60 seconds remaining.", order: 1 },
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchCritical,
    name: "Chain watch critical",
    description: "Mentions when a qualifying chain has 30 seconds remaining.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch critical", description: "Sends a Discord warning when a qualifying chain has 30 seconds remaining.", order: 2 },
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchDrop,
    name: "Chain watch dropped",
    description: "Mentions when a qualifying chain has dropped.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch dropped", description: "Sends a Discord message when a qualifying chain has dropped.", order: 3 },
  },
  {
    key: DISCORD_ALERT_KEYS.retaliationBoard,
    name: "Retaliation board",
    description: "Persistent retaliation opportunity board updates.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Retaliation board", description: "Controls the persistent retaliation opportunity board updates sent to Discord.", order: 6 },
  },
  {
    key: DISCORD_ALERT_KEYS.enemyPush,
    name: "Enemy push",
    description: "Warnings when enemy push pressure reaches likely or underway.",
    subscribable: true,
    defaultEnabled: false,
    configurable: true,
    admin: { label: "Enemy push alerts", description: "Sends pressure warnings when enemy activity looks likely to become, or is already, a push.", order: 7 },
  },
  {
    key: DISCORD_ALERT_KEYS.targetTravelTracker,
    name: "Target travel tracker",
    description: "Persistent target faction travel tracker updates.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Target travel tracker", description: "Sends target travel updates to Discord. Tracking continues when messages are off.", order: 8 },
  },
  {
    key: DISCORD_ALERT_KEYS.homeTravelTracker,
    name: "Home travel tracker",
    description: "Persistent home faction travel tracker updates.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Home travel tracker", description: "Sends home travel updates to Discord. Tracking continues when messages are off.", order: 9 },
  },
  {
    key: DISCORD_ALERT_KEYS.enemyScoutingReport,
    name: "Enemy scouting report",
    description: "War matchup scouting reports with stats images.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Enemy scouting report", description: "Sends the war matchup scouting report and stats images when enemy scouting is ready.", order: 11 },
  },
  {
    key: DISCORD_ALERT_KEYS.xanaxCompetition,
    name: "Xanax competition",
    description: "Monthly Xanax competition reminder image.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Xanax competition Discord reminder", description: "Sends the monthly Xanax competition Discord reminder image when the competition is active.", order: 12 },
  },
  {
    key: DISCORD_ALERT_KEYS.termedWarAutoEnd,
    name: "Termed war auto-end",
    description: "Notifications when a termed war score limit is reached.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Termed war auto-end notice", description: "Sends a Discord notice when a termed war score limit has been reached.", order: 13 },
  },
  {
    key: DISCORD_ALERT_KEYS.bigAlsShoplifting,
    name: "Big Als shoplifting",
    description: "Warnings when Big Als shoplifting security is down.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Big Als", description: "Sends a Discord warning when both Big Als shoplifting security obstacles are down.", order: 14 },
  },
  {
    key: DISCORD_ALERT_KEYS.jewelryStoreShoplifting,
    name: "Jewelry Store shoplifting",
    description: "Warnings when Jewelry Store shoplifting security is down.",
    subscribable: true,
    defaultEnabled: false,
    configurable: true,
    admin: { label: "Jewelry Store", description: "Sends a Discord warning when both Jewelry Store shoplifting security obstacles are down.", order: 15 },
  },
  // Append new subscriptions: existing Discord Submit buttons encode their positions.
  {
    key: DISCORD_ALERT_KEYS.chainWatchMissedCheckIn,
    name: "Chain watch missed check-in",
    description: "Mentions when a scheduled chain watcher has not checked in before their shift.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch missed check-in", description: "Controls alerts for scheduled watchers who have not checked in before their shift.", order: 5 },
  },
  {
    key: DISCORD_ALERT_KEYS.chainWatchUnfilledSlot,
    name: "Chain watch unfilled slot",
    description: "Warns one hour before a chain watch slot starts if no watcher is assigned.",
    subscribable: true,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Chain watch unfilled slot", description: "Warns one hour before a slot starts if no watcher is assigned. Sends once per slot.", order: 4 },
  },
  {
    key: DISCORD_ALERT_KEYS.itemStockLow,
    name: "Item stock low",
    description: "Available medical stock is at or below its configured threshold.",
    subscribable: false,
    defaultEnabled: true,
    configurable: true,
    admin: { label: "Item stock low", description: "Alerts once when available medical stock is at or below its threshold, until restocked.", order: 10 },
  },
] as const;

export const DISCORD_ADMIN_ALERTS = [...DISCORD_ALERTS].sort((a, b) => a.admin.order - b.admin.order);

export type DiscordAlertKey = typeof DISCORD_ALERTS[number]["key"];

export const DISCORD_DEFAULT_ALERT_ROUTE_KEY = "default" as const;

export const DISCORD_ALERT_CHANNEL_ROUTES = [
  {
    key: DISCORD_DEFAULT_ALERT_ROUTE_KEY,
    name: "Default",
    description: "Fallback bot delivery channel for alerts without a specific route.",
  },
  ...DISCORD_ALERTS,
] as const;

export type DiscordAlertRouteKey = DiscordAlertKey | typeof DISCORD_DEFAULT_ALERT_ROUTE_KEY;

export function isDiscordAlertKey(value: string): value is DiscordAlertKey {
  return DISCORD_ALERTS.some((alert) => alert.key === value);
}

export function discordAlertByKey(key: string): typeof DISCORD_ALERTS[number] | null {
  return DISCORD_ALERTS.find((alert) => alert.key === key) ?? null;
}

export function discordAlertRouteByKey(key: string): typeof DISCORD_ALERT_CHANNEL_ROUTES[number] | null {
  return DISCORD_ALERT_CHANNEL_ROUTES.find((alert) => alert.key === key) ?? null;
}
