const OPTION_TYPES = {
  subCommand: 1,
  string: 3,
  integer: 4,
};

const commands = [
  {
    name: "war",
    description: "War room summaries and member performance",
    options: [
      {
        type: OPTION_TYPES.subCommand,
        name: "current",
        description: "Show the active or latest war summary",
      },
      {
        type: OPTION_TYPES.subCommand,
        name: "members",
        description: "Show a member leaderboard for the active or latest war",
        options: [
          {
            type: OPTION_TYPES.string,
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
            type: OPTION_TYPES.integer,
            name: "limit",
            description: "Number of members to show",
            required: false,
            min_value: 5,
            max_value: 20,
          },
        ],
      },
      {
        type: OPTION_TYPES.subCommand,
        name: "enemy",
        description: "Show enemy status, travel, or scouting",
        options: [
          {
            type: OPTION_TYPES.string,
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
    name: "travel",
    description: "Enemy travel tracker",
    options: [
      {
        type: OPTION_TYPES.subCommand,
        name: "current",
        description: "Show enemy travelers and abroad members",
        options: [
          {
            type: OPTION_TYPES.string,
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
            type: OPTION_TYPES.integer,
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
    name: "chain",
    description: "Chain watch status",
    options: [
      {
        type: OPTION_TYPES.subCommand,
        name: "status",
        description: "Show current chain watch status",
      },
    ],
  },
  {
    name: "bot",
    description: "Bot help",
    options: [
      {
        type: OPTION_TYPES.subCommand,
        name: "help",
        description: "Show available commands",
      },
    ],
  },
];

const token = requiredEnv("DISCORD_BOT_TOKEN");
const applicationId = requiredEnv("DISCORD_APPLICATION_ID");
const guildMode = process.argv.includes("--guild");
const guildId = guildMode ? requiredEnv("DISCORD_GUILD_ID") : null;
const route = guildId
  ? `/applications/${applicationId}/guilds/${guildId}/commands`
  : `/applications/${applicationId}/commands`;

const response = await fetch(`https://discord.com/api/v10${route}`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const bodyText = await response.text();
if (!response.ok) {
  throw new Error(`Discord command registration failed with HTTP ${response.status}: ${bodyText}`);
}

console.log(`Registered ${commands.length} Discord commands ${guildId ? `for guild ${guildId}` : "globally"}.`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
