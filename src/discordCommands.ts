export const DISCORD_COMMAND_NAMES = {
  war: "war",
  travel: "travel",
  chain: "chain",
  bot: "bot",
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
      name: DISCORD_COMMAND_NAMES.travel,
      description: "Enemy travel tracker",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "current",
          description: "Show enemy travelers and abroad members",
          options: [
            {
              type: DISCORD_COMMAND_OPTION_TYPES.string,
              name: "view",
              description: "Travel view",
              required: false,
              choices: [
                { name: "All", value: "all" },
                { name: "Traveling", value: "traveling" },
                { name: "Abroad", value: "abroad" },
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
      ],
    },
    {
      name: DISCORD_COMMAND_NAMES.chain,
      description: "Chain watch status",
      options: [
        {
          type: DISCORD_COMMAND_OPTION_TYPES.subCommand,
          name: "status",
          description: "Show current chain watch status",
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
  ];
}
