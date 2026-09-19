import { DISCORD_ALERT_CHANNEL_ROUTES } from "./discordAlerts";

// TEMPORARY: public creation/setfinish for testing. Set false and redeploy the
// Worker + re-register commands to restore server-administrator access.
export const CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING = true;

export const DISCORD_COMMAND_NAMES = {
  bot: "bot",
  alerts: "alerts",
  alertChannels: "alert-channels",
  lookup: "lookup",
  chainWatch: "chain-watch",
  war: "war",
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
  autocomplete?: boolean;
  choices?: Array<{
    name: string;
    value: string;
  }>;
  options?: DiscordCommandOption[];
};

export function discordApplicationCommands(): DiscordApplicationCommand[] {
  const notificationAlertChoices = DISCORD_ALERT_CHANNEL_ROUTES
    .map((alert) => ({ name: alert.name, value: alert.key }));

  return [
    {
      name: DISCORD_COMMAND_NAMES.war,
      description: "View your ongoing war stats",
      dm_permission: false,
      options: [
        { type: DISCORD_COMMAND_OPTION_TYPES.subCommand, name: "me", description: "Show your successful attacks, adjusted respect, raw respect, and war page" },
      ],
    },
    {
      name: DISCORD_COMMAND_NAMES.chainWatch,
      description: "Create or finish the faction chain watch",
      dm_permission: false,
      ...(CHAIN_WATCH_COMMANDS_PUBLIC_FOR_TESTING ? {} : { default_member_permissions: "8" }),
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "create",
          description: "Create the faction's only watch and post its sign-up sheet here",
          options: [
            { type: 3, name: "name", description: "Name of this watch", required: true },
            { type: 3, name: "start", description: "Pick a UTC hour or type 18 / 18:00; date: DD-MM-YY HH:00; default: next whole hour", autocomplete: true },
            { type: 3, name: "finish", description: "Pick a UTC hour after start or DD-MM-YY HH:00; omit for ongoing daily sheets", autocomplete: true },
          ],
        },
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "setfinish",
          description: "Set the watch's finish or resume ongoing daily sheets",
          options: [{ type: 3, name: "finish", description: "Choose a UTC hour, DD-MM-YY HH:00, or ongoing to remove the finish", required: true, autocomplete: true }],
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
    {
      name: DISCORD_COMMAND_NAMES.lookup,
      description: "Look up a Torn player",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.integer,
          name: "player_id",
          description: "Torn player ID",
          required: true,
          min_value: 1,
        },
      ],
    },
  ];
}
