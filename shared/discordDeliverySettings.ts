// These settings control Discord delivery independently of tracking and events.
export const DISCORD_DELIVERY_CONTROLS = [
  {
    key: "chain_watch_warning",
    name: "Chain watch warning",
    description: "Sends a Discord warning when a qualifying chain has 60 seconds remaining.",
  },
  {
    key: "chain_watch_critical",
    name: "Chain watch critical",
    description: "Sends a Discord warning when a qualifying chain has 30 seconds remaining.",
  },
  {
    key: "chain_watch_drop",
    name: "Chain watch dropped",
    description: "Sends a Discord message when a qualifying chain has dropped.",
  },
  {
    key: "chain_watch_unfilled_slot",
    name: "Chain watch unfilled slot",
    description: "Warns one hour before a slot starts if no watcher is assigned. Sends once per slot.",
  },
  {
    key: "target_travel_tracker",
    name: "Target travel tracker",
    description: "Sends target travel updates to Discord. Tracking continues when messages are off.",
  },
  {
    key: "home_travel_tracker",
    name: "Home travel tracker",
    description: "Sends home travel updates to Discord. Tracking continues when messages are off.",
  },
] as const;

export type DiscordDeliveryAlertKey = typeof DISCORD_DELIVERY_CONTROLS[number]["key"];

export type DiscordDeliveryAlertSetting = {
  key: DiscordDeliveryAlertKey;
  name: string;
  enabled: boolean;
  configurable: boolean;
};
