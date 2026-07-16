import { DISCORD_ALERTS } from "./discordAlerts";

export const DISCORD_COMMAND_NAMES = {
  war: "war",
  bot: "bot",
  alerts: "alerts",
} as const;

export const DISCORD_COMPONENT_IDS = {
  warCurrent: "discord:war:current",
  warMembersRespect: "discord:war:members:respect",
  warEnemyStatus: "discord:war:enemy:status",
  travelCurrent: "discord:travel:current",
  chainStatus: "discord:chain:status",
} as const;

export const DISCORD_COMMAND_OPTION_TYPES = {
  subCommand: 1,
  string: 3,
  integer: 4,
} as const;

export type DiscordApplicationCommand = {
  name: string;
  description: string;
  options?: DiscordCommandOption[];
};

type DiscordCommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
  choices?: Array<{
    name: string;
    value: string;
  }>;
  options?: DiscordCommandOption[];
};

export function discordApplicationCommands(): DiscordApplicationCommand[] {
  const alertChoices = DISCORD_ALERTS
    .filter((alert) => alert.subscribable)
    .map((alert) => ({ name: alert.name, value: alert.key }));

  return [
    {
      name: DISCORD_COMMAND_NAMES.war,
      description: "War room summaries and member performance",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "current",
          description: "Show the active or latest war summary",
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "members",
          description: "Show a member leaderboard for the active or latest war",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "metric",
              description: "Leaderboard metric",
              required: false,
              choices: [
                { name: "Respect", value: "respect" },
                { name: "Attacks", value: "attacks" },
                { name: "Defends", value: "defends" },
                { name: "Outside", value: "outside" },
              ],
            },
            {
              type: DISCORD_COMMAND_OPTION_TYPES.integer,
              name: "limit",
              description: "Number of members to show",
              required: false,
              min_value: 5,
              max_value: 20,
            },
          ],
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "enemy",
          description: "Show enemy status, travel, or scouting",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "view",
              description: "Enemy view",
              required: false,
              choices: [
                { name: "Status", value: "status" },
                { name: "Travel", value: "travel" },
                { name: "Scouting", value: "scouting" },
              ],
            },
          ],
        },
      ],
    },
    {
      name: DISCORD_COMMAND_NAMES.bot,
      description: "Bot help",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "help",
          description: "Show available commands",
        },
      ],
    },
    {
      name: DISCORD_COMMAND_NAMES.alerts,
      description: "Manage your Discord alert subscriptions",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "list",
          description: "Show available subscribable alerts",
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "subscribed",
          description: "Show your active alert subscriptions",
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "subscribe",
          description: "Subscribe yourself to an alert",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "alert",
              description: "Alert to subscribe to",
              required: true,
              choices: alertChoices,
            },
          ],
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "unsubscribe",
          description: "Unsubscribe yourself from an alert",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "alert",
              description: "Alert to unsubscribe from",
              required: true,
              choices: alertChoices,
            },
          ],
        },
      ],
    },
  ];
}
