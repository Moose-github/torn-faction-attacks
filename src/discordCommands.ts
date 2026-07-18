import { DISCORD_ALERTS } from "./discordAlerts";

export const DISCORD_COMMAND_NAMES = {
  war: "war",
  bot: "bot",
  alerts: "alerts",
  alertChannels: "alert-channels",
} as const;

export const DISCORD_COMPONENT_IDS = {
  warCurrent: "discord:war:current",
  warMembersRespect: "discord:war:members:respect",
  warEnemyStatus: "discord:war:enemy:status",
  travelCurrent: "discord:travel:current",
  chainStatus: "discord:chain:status",
  alertsManageSelect: "discord:alerts:manage:select",
  alertsManageClear: "discord:alerts:manage:clear",
  alertsManageSubmitPrefix: "discord:alerts:manage:submit:",
} as const;

export const DISCORD_COMMAND_OPTION_TYPES = {
  subCommand: 1,
  subCommandGroup: 2,
  string: 3,
  integer: 4,
  channel: 7,
} as const;

export type DiscordApplicationCommand = {
  name: string;
  description: string;
  default_member_permissions?: string;
  dm_permission?: boolean;
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
  const notificationAlertChoices = DISCORD_ALERTS
    .map((alert) => ({ name: alert.name, value: alert.key }));

  return [
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
          name: "manage",
          description: "Manage your alert subscriptions with a dropdown",
        },
      ],
    },
    {
      name: DISCORD_COMMAND_NAMES.alertChannels,
      description: "Configure Discord alert delivery channels",
      default_member_permissions: "32",
      dm_permission: false,
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "list",
          description: "Show configured alert delivery channels",
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "set",
          description: "Send an alert type to a channel",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "alert",
              description: "Alert to route",
              required: true,
              choices: notificationAlertChoices,
            },
            {
              type: DISCORD_COMMAND_OPTION_TYPES.channel,
              name: "channel",
              description: "Channel for this alert",
              required: true,
            },
          ],
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "unset",
          description: "Remove an alert channel route",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "alert",
              description: "Alert route to remove",
              required: true,
              choices: notificationAlertChoices,
            },
          ],
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "test",
          description: "Send a test message to a configured alert channel",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "alert",
              description: "Alert route to test",
              required: true,
              choices: notificationAlertChoices,
            },
          ],
        },
      ],
    },
  ];
}
