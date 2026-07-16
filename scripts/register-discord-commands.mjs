const OPTION_TYPES = {
  subCommand: 1,
  string: 3,
  integer: 4,
};

const alertChoices = [
  { name: "Chain watch warning", value: "chain_watch_warning" },
  { name: "Chain watch critical", value: "chain_watch_critical" },
  { name: "Chain watch dropped", value: "chain_watch_drop" },
  { name: "Enemy push", value: "enemy_push" },
  { name: "Big Als shoplifting", value: "shoplifting_security_alert:big_als" },
  { name: "Jewelry Store shoplifting", value: "shoplifting_security_alert:jewelry_store" },
];

const commands = [
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
  {
    name: "alerts",
    description: "Manage your Discord alert subscriptions",
    options: [
      {
        type: OPTION_TYPES.subCommand,
        name: "list",
        description: "Show available subscribable alerts",
      },
      {
        type: OPTION_TYPES.subCommand,
        name: "subscribed",
        description: "Show your active alert subscriptions",
      },
      {
        type: OPTION_TYPES.subCommand,
        name: "subscribe",
        description: "Subscribe yourself to an alert",
        options: [
          {
            type: OPTION_TYPES.string,
            name: "alert",
            description: "Alert to subscribe to",
            required: true,
            choices: alertChoices,
          },
        ],
      },
      {
        type: OPTION_TYPES.subCommand,
        name: "unsubscribe",
        description: "Unsubscribe yourself from an alert",
        options: [
          {
            type: OPTION_TYPES.string,
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
