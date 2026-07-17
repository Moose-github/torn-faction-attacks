import { pathToFileURL } from "node:url";

const OPTION_TYPES = {
  subCommand: 1,
  subCommandGroup: 2,
  string: 3,
  integer: 4,
  channel: 7,
};

const notificationAlertChoices = [
  { name: "Chain watch", value: "chain_watch" },
  { name: "Chain watch warning", value: "chain_watch_warning" },
  { name: "Chain watch critical", value: "chain_watch_critical" },
  { name: "Chain watch dropped", value: "chain_watch_drop" },
  { name: "Retaliation board", value: "retaliation_board" },
  { name: "Enemy push", value: "enemy_push" },
  { name: "Big Als shoplifting", value: "shoplifting_security_alert:big_als" },
  { name: "Jewelry Store shoplifting", value: "shoplifting_security_alert:jewelry_store" },
];
const subscriptionAlertChoices = notificationAlertChoices
  .filter((alert) => !["chain_watch", "retaliation_board"].includes(alert.value));

export const commands = [
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
            choices: subscriptionAlertChoices,
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
            choices: subscriptionAlertChoices,
          },
        ],
      },
      {
        type: OPTION_TYPES.subCommandGroup,
        name: "channels",
        description: "Configure alert delivery channels",
        options: [
          {
            type: OPTION_TYPES.subCommand,
            name: "list",
            description: "Show configured alert delivery channels",
          },
          {
            type: OPTION_TYPES.subCommand,
            name: "set",
            description: "Send an alert type to a channel",
            options: [
              {
                type: OPTION_TYPES.string,
                name: "alert",
                description: "Alert to route",
                required: true,
                choices: notificationAlertChoices,
              },
              {
                type: OPTION_TYPES.channel,
                name: "channel",
                description: "Channel for this alert",
                required: true,
              },
            ],
          },
          {
            type: OPTION_TYPES.subCommand,
            name: "unset",
            description: "Remove an alert channel route",
            options: [
              {
                type: OPTION_TYPES.string,
                name: "alert",
                description: "Alert route to remove",
                required: true,
                choices: notificationAlertChoices,
              },
            ],
          },
          {
            type: OPTION_TYPES.subCommand,
            name: "test",
            description: "Send a test message to a configured alert channel",
            options: [
              {
                type: OPTION_TYPES.string,
                name: "alert",
                description: "Alert route to test",
                required: true,
                choices: notificationAlertChoices,
              },
            ],
          },
        ],
      },
    ],
  },
];

export async function registerDiscordCommands({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const token = requiredEnv(env, "DISCORD_BOT_TOKEN");
  const applicationId = requiredEnv(env, "DISCORD_APPLICATION_ID");
  const guildMode = argv.includes("--guild");
  const guildId = guildMode ? requiredEnv(env, "DISCORD_GUILD_ID") : null;
  const route = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;

  const response = await fetchImpl(`https://discord.com/api/v10${route}`, {
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

  return {
    commandCount: commands.length,
    guildId,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await registerDiscordCommands();
  console.log(`Registered ${result.commandCount} Discord commands ${result.guildId ? `for guild ${result.guildId}` : "globally"}.`);
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
