import { isRecord } from "./backend/request";
import { DISCORD_COMMAND_NAMES, DISCORD_COMPONENT_IDS } from "./discordCommands";
import { DISCORD_ALERTS, discordAlertByKey } from "./discordAlerts";
import { createDiscordBotMessage } from "./discord";
import {
  readDiscordMemberAlertSubscriptionsForDiscordUser,
  updateDiscordMemberAlertSubscription,
  type DiscordMemberAlertSubscriptionSetting,
  type DiscordMemberAlertSubscriptionsResponse,
} from "./discordMemberAlertSubscriptions";
import {
  listDiscordNotificationChannels,
  readDiscordNotificationChannel,
  setDiscordNotificationChannel,
  unsetDiscordNotificationChannel,
  type DiscordNotificationChannel,
} from "./discordNotificationChannels";
import {
  formatTravelTrackerSections,
  travelCounts,
  type DiscordTravelRow,
} from "./discordTravelFormatting";
import { Env, WarRow, WarSummaryRow } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

const DISCORD_INTERACTION_PING = 1;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3;
const DISCORD_RESPONSE_PONG = 1;
const DISCORD_RESPONSE_CHANNEL_MESSAGE = 4;
const DISCORD_RESPONSE_UPDATE_MESSAGE = 7;
const DISCORD_FLAG_EPHEMERAL = 1 << 6;
const DISCORD_COMPONENT_ACTION_ROW = 1;
const DISCORD_COMPONENT_BUTTON = 2;
const DISCORD_COMPONENT_STRING_SELECT = 3;
const DISCORD_BUTTON_PRIMARY = 1;
const DISCORD_BUTTON_SECONDARY = 2;
const DISCORD_BUTTON_SUCCESS = 3;
const DISCORD_BUTTON_LINK = 5;
const BOT_COLOR = 0x2f80ed;
const WARNING_COLOR = 0xffa500;
const DISCORD_EMBED_DESCRIPTION_SAFE_LIMIT = 3900;
const DISCORD_SELECT_OPTION_DESCRIPTION_LIMIT = 100;
const DASHBOARD_SETTINGS_URL = "https://buttgrass.pages.dev/settings";

type DiscordInteraction = {
  type?: number;
  guild_id?: string;
  channel_id?: string;
  user?: DiscordInteractionUser;
  member?: {
    user?: DiscordInteractionUser;
    roles?: string[];
  };
  data?: {
    name?: string;
    custom_id?: string;
    options?: DiscordOption[];
    values?: string[];
  };
};

type DiscordInteractionUser = {
  id?: string;
};

type DiscordOption = {
  name: string;
  type: number;
  value?: string | number;
  options?: DiscordOption[];
};

type DiscordEmbed = {
  title: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
};

type DiscordInteractionResponse = {
  type: number;
  data?: {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordComponent[];
    flags?: number;
    allowed_mentions?: {
      parse: [];
    };
  };
};

type DiscordComponent = {
  type: number;
  components: Array<DiscordButtonComponent | DiscordStringSelectComponent>;
};

type DiscordButtonComponent = {
    type: number;
    style: number;
    label: string;
    custom_id?: string;
    url?: string;
};

type DiscordStringSelectComponent = {
  type: number;
  custom_id: string;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    default?: boolean;
  }>;
};

type WarSummaryForDiscord = WarRow & Partial<WarSummaryRow> & {
  summary_updated_at: number | null;
};

type DiscordTravelTarget =
  | {
      source: "war";
      factionId: number;
      title: string;
      war: WarSummaryForDiscord;
    }
  | {
      source: "manual";
      factionId: number;
      title: string;
      war: null;
    };

type DiscordTravelTrackerTargetRow = {
  faction_id: number;
  faction_name: string | null;
};

type MemberLeaderboardRow = {
  member_id: number;
  member_name: string | null;
  discord_user_id: string | null;
  attacks_vs_enemy_total: number;
  attacks_vs_enemy_successful: number;
  respect_gained: number;
  defends_total: number;
  defends_won: number;
  outside_hits: number;
};

type ChainWatchDiscordRow = {
  war_id: number;
  enabled: number;
  source: string;
  current_chain: number | null;
  timeout_at: number | null;
  last_hit_attacker_name: string | null;
  last_hit_defender_name: string | null;
  last_hit_result: string | null;
  warning_60_sent_at: number | null;
  warning_30_sent_at: number | null;
  drop_sent_at: number | null;
  last_checked_at: number | null;
};

type EnemyStatusSummaryRow = {
  total: number;
  okay: number;
  hospital: number;
  traveling: number;
  abroad: number;
  unknown: number;
  stats_available: number;
  average_level: number | null;
  average_ff_battlestats: number | null;
};

type TravelTrackerRow = DiscordTravelRow;

export async function handleDiscordInteractions(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/discord/interactions") {
    return null;
  }

  if (!env.DISCORD_PUBLIC_KEY) {
    return json({ ok: false, error: "DISCORD_PUBLIC_KEY is not configured", code: "MISSING_DISCORD_PUBLIC_KEY" }, 500);
  }

  const bodyText = await request.text();
  const verified = await verifyDiscordRequestSignature(request, bodyText, env.DISCORD_PUBLIC_KEY);
  if (!verified) {
    return json({ ok: false, error: "Invalid Discord interaction signature", code: "INVALID_SIGNATURE" }, 401);
  }

  const interaction = parseDiscordInteraction(bodyText);
  if (!interaction) {
    return json({ ok: false, error: "Invalid Discord interaction payload", code: "INVALID_INTERACTION" }, 400);
  }

  try {
    const response = await handleVerifiedDiscordInteraction(interaction, env);
    return json(response);
  } catch (error) {
    logDiscordInteractionError(interaction, error);
    return json(ephemeralMessage("Discord bot is temporarily unavailable. Please try again shortly."));
  }
}

export async function verifyDiscordRequestSignature(
  request: Request,
  bodyText: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signatureHex = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  const publicKeyBytes = hexToBytes(publicKeyHex);
  const signatureBytes = hexToBytes(signatureHex);

  if (!timestamp || publicKeyBytes === null || signatureBytes === null) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      new TextEncoder().encode(`${timestamp}${bodyText}`),
    );
  } catch {
    return false;
  }
}

export async function handleVerifiedDiscordInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  if (interaction.type === DISCORD_INTERACTION_PING) {
    return { type: DISCORD_RESPONSE_PONG };
  }

  if (interaction.type === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
    return routeDiscordComponent(interaction, env);
  }

  if (interaction.type !== DISCORD_INTERACTION_APPLICATION_COMMAND) {
    return ephemeralMessage("Unsupported Discord interaction.");
  }

  return routeDiscordCommand(interaction, env);
}

function parseDiscordInteraction(bodyText: string): DiscordInteraction | null {
  try {
    const parsed = JSON.parse(bodyText);
    return isRecord(parsed) ? parsed as DiscordInteraction : null;
  } catch {
    return null;
  }
}

async function routeDiscordCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const command = interaction.data?.name;
  const subcommand = interaction.data?.options?.[0] ?? null;

  if (command === DISCORD_COMMAND_NAMES.war && subcommand?.name === "current") {
    return warCurrentResponse(env, DISCORD_RESPONSE_CHANNEL_MESSAGE);
  }

  if (command === DISCORD_COMMAND_NAMES.war && subcommand?.name === "members") {
    return warMembersResponse(env, optionString(subcommand, "metric") ?? "respect", optionInteger(subcommand, "limit"));
  }

  if (command === DISCORD_COMMAND_NAMES.war && subcommand?.name === "enemy") {
    const view = optionString(subcommand, "view") ?? "status";
    return view === "travel" ? travelCurrentResponse(env, "all", 10) : warEnemyResponse(env, view);
  }

  if (command === DISCORD_COMMAND_NAMES.bot && subcommand?.name === "help") {
    return botHelpResponse();
  }

  if (command === DISCORD_COMMAND_NAMES.alerts) {
    return alertsResponse(interaction, subcommand, env);
  }

  if (command === DISCORD_COMMAND_NAMES.alertChannels) {
    return alertChannelsResponse(interaction, env, subcommand);
  }

  return ephemeralMessage("I do not know that command yet.");
}

async function routeDiscordComponent(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const customId = interaction.data?.custom_id ?? "";
  if (customId === DISCORD_COMPONENT_IDS.warCurrent) {
    return warCurrentResponse(env, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.warMembersRespect) {
    return warMembersResponse(env, "respect", 10, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.warEnemyStatus) {
    return warEnemyResponse(env, "status", DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.travelCurrent) {
    return travelCurrentResponse(env, "all", 10, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.chainStatus) {
    return chainStatusResponse(env, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.alertsManageSelect) {
    return updateAlertSubscriptionsFromSelectResponse(interaction, env);
  }

  if (customId === DISCORD_COMPONENT_IDS.alertsManageClear) {
    return clearPendingAlertSubscriptionsResponse(interaction, env);
  }

  if (customId.startsWith(DISCORD_COMPONENT_IDS.alertsManageSubmitPrefix)) {
    return submitAlertSubscriptionsResponse(interaction, env);
  }

  return ephemeralMessage("That Discord component is no longer supported.");
}

async function warCurrentResponse(env: Env, responseType: number): Promise<DiscordInteractionResponse> {
  const war = await readActiveOrLatestWar(env);
  if (!war) {
    return ephemeralMessage("No wars have been recorded yet.");
  }

  return discordMessageResponse(responseType, {
    embeds: [
      {
        title: `${war.status === "active" ? "Active war" : "Latest war"}: ${war.name}`,
        color: war.status === "active" ? BOT_COLOR : WARNING_COLOR,
        fields: [
          { name: "Attacks vs enemy", value: integerField(war.attacks_vs_enemy_total), inline: true },
          { name: "Attacks from enemy", value: integerField(war.attacks_from_enemy_total), inline: true },
          { name: "Outside hits", value: integerField(war.outside_hits), inline: true },
          { name: "Respect gained", value: numberField(war.total_respect_gain), inline: true },
          { name: "Respect lost", value: numberField(war.total_respect_lost), inline: true },
          { name: "Unique attackers", value: integerField(war.unique_attackers), inline: true },
          { name: "Started", value: discordTimestamp(war.practical_start_time), inline: true },
          { name: "Last attack", value: nullableTimestamp(war.last_attack_at), inline: true },
          { name: "Status", value: war.status, inline: true },
        ],
      },
    ],
    components: warComponents(env, war),
  });
}

async function warMembersResponse(
  env: Env,
  metric: string,
  rawLimit: number | null,
  responseType = DISCORD_RESPONSE_CHANNEL_MESSAGE,
): Promise<DiscordInteractionResponse> {
  const war = await readActiveOrLatestWar(env);
  if (!war) {
    return ephemeralMessage("No wars have been recorded yet.");
  }

  const normalizedMetric = ["respect", "attacks", "defends", "outside"].includes(metric) ? metric : "respect";
  const limit = parseLimit(rawLimit === null ? null : String(rawLimit), 10, 20);
  const members = await readWarMemberLeaderboard(env, war.id, normalizedMetric, limit);
  const description = members.length === 0
    ? "No member stats are available for this war yet."
    : members.map((member, index) => leaderboardLine(index + 1, member, normalizedMetric)).join("\n");

  return discordMessageResponse(responseType, {
    embeds: [
      {
        title: `${war.name} member leaderboard`,
        description,
        color: BOT_COLOR,
      },
    ],
    components: warComponents(env, war),
  });
}

async function warEnemyResponse(
  env: Env,
  view: string,
  responseType = DISCORD_RESPONSE_CHANNEL_MESSAGE,
): Promise<DiscordInteractionResponse> {
  const war = await readActiveOrLatestWar(env);
  if (!war) {
    return ephemeralMessage("No wars have been recorded yet.");
  }

  if (war.enemy_faction_id === null) {
    return ephemeralMessage("This war does not have an enemy faction ID.");
  }

  const summary = await readEnemyStatusSummary(env, war.enemy_faction_id);
  const normalizedView = ["status", "travel", "scouting"].includes(view) ? view : "status";

  return discordMessageResponse(responseType, {
    embeds: [
      {
        title: `${war.name} enemy ${normalizedView}`,
        color: BOT_COLOR,
        fields: enemyFields(summary, normalizedView),
      },
    ],
    components: warComponents(env, war),
  });
}

async function travelCurrentResponse(
  env: Env,
  view: string,
  rawLimit: number | null,
  responseType = DISCORD_RESPONSE_CHANNEL_MESSAGE,
): Promise<DiscordInteractionResponse> {
  const target = await readDiscordTravelTarget(env);
  if (!target) {
    return ephemeralMessage("No active war-room or manual faction travel tracking is configured.");
  }

  const normalizedView = ["all", "traveling", "abroad"].includes(view) ? view : "all";
  const limit = parseLimit(rawLimit === null ? null : String(rawLimit), 10, 20);
  const members = await readTravelTrackerRows(env, target.factionId, normalizedView, limit);
  const description = travelTrackerDescription(members, normalizedView);
  const counts = travelCounts(members);

  return discordMessageResponse(responseType, {
    embeds: [
      {
        title: target.title,
        description,
        color: BOT_COLOR,
        fields: [
          { name: "Traveling shown", value: integerField(counts.traveling), inline: true },
          { name: "Abroad shown", value: integerField(counts.abroad), inline: true },
          { name: "View", value: normalizedView, inline: true },
        ],
      },
    ],
    components: target.war ? warComponents(env, target.war) : [],
  });
}

async function chainStatusResponse(env: Env, responseType: number): Promise<DiscordInteractionResponse> {
  const war = await readActiveOrLatestWar(env);
  if (!war) {
    return ephemeralMessage("No wars have been recorded yet.");
  }

  const chain = await readChainWatchForWar(env, war.id);
  if (!chain) {
    return discordMessageResponse(responseType, {
      embeds: [
        {
          title: `${war.name} chain watch`,
          description: "Chain watch has not been initialized for this war.",
          color: WARNING_COLOR,
        },
      ],
      components: warComponents(env, war),
    });
  }

  const remaining = chain.timeout_at ? Math.max(0, chain.timeout_at - nowSeconds()) : null;
  return discordMessageResponse(responseType, {
    embeds: [
      {
        title: `${war.name} chain watch`,
        color: remaining !== null && remaining <= 60 ? WARNING_COLOR : BOT_COLOR,
        fields: [
          { name: "Enabled", value: chain.enabled === 1 ? "Yes" : "No", inline: true },
          { name: "Chain", value: integerField(chain.current_chain), inline: true },
          { name: "Timeout", value: nullableTimestamp(chain.timeout_at), inline: true },
          { name: "Remaining", value: remaining === null ? "Unknown" : `${remaining}s`, inline: true },
          { name: "Last hit", value: chainAttackPair(chain), inline: true },
          { name: "Source", value: chain.source, inline: true },
        ],
      },
    ],
    components: warComponents(env, war),
  });
}

function botHelpResponse(): DiscordInteractionResponse {
  return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
    flags: DISCORD_FLAG_EPHEMERAL,
    embeds: [
      {
        title: "Butt Dashboard Bot",
        description: [
          "`/alerts list` - available alert subscriptions",
          "`/alerts manage` - manage alert subscriptions with a dropdown",
          "`/alerts subscribe` - subscribe yourself to an alert",
          "`/alerts unsubscribe` - unsubscribe yourself from an alert",
        ].join("\n"),
        color: BOT_COLOR,
      },
    ],
  });
}

async function alertsResponse(
  interaction: DiscordInteraction,
  subcommand: DiscordOption | null,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!discordUserId) {
    return ephemeralMessage("Discord did not include your user ID with this interaction.");
  }

  if (subcommand?.name === "list") {
    const subscriptions = await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId);
    return alertsListResponse(subscriptions);
  }

  const subscriptions = await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId);
  if (!subscriptions) {
    return ephemeralMessage("I cannot find a Torn member linked to your Discord account yet.");
  }

  if (subcommand?.name === "manage") {
    return alertsManageResponse(subscriptions, DISCORD_RESPONSE_CHANNEL_MESSAGE);
  }

  if (subcommand?.name === "subscribe" || subcommand?.name === "unsubscribe") {
    const alertKey = optionString(subcommand, "alert") ?? "";
    const alert = discordAlertByKey(alertKey);
    if (!alert || !alert.subscribable) {
      return ephemeralMessage("That alert is not available for member subscriptions.");
    }

    const enabled = subcommand.name === "subscribe";
    const result = await updateDiscordMemberAlertSubscription(
      env,
      subscriptions.discord_link.torn_user_id,
      alert.key,
      enabled,
    );
    if (result !== "ok") {
      return ephemeralMessage("I could not update that alert subscription.");
    }

    return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
      flags: DISCORD_FLAG_EPHEMERAL,
      embeds: [
        {
          title: enabled ? "Alert subscribed" : "Alert unsubscribed",
          description: `${enabled ? "You are now subscribed to" : "You are no longer subscribed to"} **${alert.name}**.`,
          color: BOT_COLOR,
        },
      ],
    });
  }

  return ephemeralMessage("Use `/alerts list`, `/alerts manage`, `/alerts subscribe`, or `/alerts unsubscribe`.");
}

async function updateAlertSubscriptionsFromSelectResponse(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!discordUserId) {
    return ephemeralMessage("Discord did not include your user ID with this interaction.");
  }

  const subscriptions = await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId);
  if (!subscriptions) {
    return ephemeralMessage("I cannot find a Torn member linked to your Discord account yet.");
  }

  const selectedAlertKeys = new Set(
    (interaction.data?.values ?? []).filter((value) => {
      const alert = discordAlertByKey(value);
      return Boolean(alert?.subscribable);
    }),
  );

  return alertsManageResponse(
    subscriptions,
    DISCORD_RESPONSE_UPDATE_MESSAGE,
    "Review your changes, then press Submit to save them.",
    selectedAlertKeys,
  );
}

async function clearPendingAlertSubscriptionsResponse(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!discordUserId) {
    return ephemeralMessage("Discord did not include your user ID with this interaction.");
  }

  const subscriptions = await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId);
  if (!subscriptions) {
    return ephemeralMessage("I cannot find a Torn member linked to your Discord account yet.");
  }

  return alertsManageResponse(
    subscriptions,
    DISCORD_RESPONSE_UPDATE_MESSAGE,
    "All alerts are cleared in this pending selection. Press Submit to save.",
    new Set(),
  );
}

async function submitAlertSubscriptionsResponse(
  interaction: DiscordInteraction,
  env: Env,
): Promise<DiscordInteractionResponse> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!discordUserId) {
    return ephemeralMessage("Discord did not include your user ID with this interaction.");
  }

  const subscriptions = await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId);
  if (!subscriptions) {
    return ephemeralMessage("I cannot find a Torn member linked to your Discord account yet.");
  }

  const selectedAlertKeys = decodeAlertSelection(
    subscriptions.alerts,
    interaction.data?.custom_id?.slice(DISCORD_COMPONENT_IDS.alertsManageSubmitPrefix.length) ?? "",
  );

  await Promise.all(subscriptions.alerts.map((alert) =>
    updateDiscordMemberAlertSubscription(
      env,
      subscriptions.discord_link.torn_user_id,
      alert.key,
      selectedAlertKeys.has(alert.key),
    )
  ));

  const updatedSubscriptions =
    await readDiscordMemberAlertSubscriptionsForDiscordUser(env, discordUserId) ?? subscriptions;
  return alertsManageResponse(
    updatedSubscriptions,
    DISCORD_RESPONSE_UPDATE_MESSAGE,
    "Saved your alert subscriptions.",
  );
}

async function alertChannelsResponse(
  interaction: DiscordInteraction,
  env: Env,
  subcommand: DiscordOption | null,
): Promise<DiscordInteractionResponse> {
  const discordUserId = interactionDiscordUserId(interaction);
  if (!discordUserId) {
    return ephemeralMessage("Discord did not include your user ID with this interaction.");
  }

  const guildId = interaction.guild_id;
  if (!guildId) {
    return ephemeralMessage("Alert channel routing can only be configured inside a Discord server.");
  }

  if (subcommand?.name === "list") {
    return alertChannelsListResponse(await listDiscordNotificationChannels(env, guildId));
  }

  if (subcommand?.name === "set") {
    const alert = alertOption(subcommand);
    if (!alert) {
      return ephemeralMessage("That alert is not available for channel routing.");
    }
    const channelId = optionString(subcommand, "channel");
    if (!channelId || !/^\d{5,32}$/.test(channelId)) {
      return ephemeralMessage("Choose a valid Discord channel for this alert route.");
    }

    const route = await setDiscordNotificationChannel(env, {
      guildId,
      alertKey: alert.key,
      channelId,
      updatedByDiscordId: discordUserId,
    });
    return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
      flags: DISCORD_FLAG_EPHEMERAL,
      embeds: [
        {
          title: "Alert channel route saved",
          description: `**${route.alertName}** will be sent to ${discordChannelMention(route.channelId)}.`,
          color: BOT_COLOR,
        },
      ],
    });
  }

  if (subcommand?.name === "unset") {
    const alert = alertOption(subcommand);
    if (!alert) {
      return ephemeralMessage("That alert is not available for channel routing.");
    }

    await unsetDiscordNotificationChannel(env, guildId, alert.key);
    return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
      flags: DISCORD_FLAG_EPHEMERAL,
      embeds: [
        {
          title: "Alert channel route removed",
          description: `**${alert.name}** no longer has a bot delivery channel configured.`,
          color: WARNING_COLOR,
        },
      ],
    });
  }

  if (subcommand?.name === "test") {
    const alert = alertOption(subcommand);
    if (!alert) {
      return ephemeralMessage("That alert is not available for channel routing.");
    }

    const route = await readDiscordNotificationChannel(env, guildId, alert.key);
    if (!route) {
      return ephemeralMessage(`No channel route is configured for **${alert.name}**.`);
    }

    await createDiscordBotMessage(
      env,
      route.channelId,
      `Discord alert route test: ${alert.name}`,
      { users: [], roles: [] },
      {
        embeds: [
          {
            title: "Discord alert route test",
            description: `This channel is configured for **${alert.name}** alerts.`,
            color: BOT_COLOR,
          },
        ],
      },
    );

    return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
      flags: DISCORD_FLAG_EPHEMERAL,
      embeds: [
        {
          title: "Test alert sent",
          description: `Sent a test message to ${discordChannelMention(route.channelId)} for **${route.alertName}**.`,
          color: BOT_COLOR,
        },
      ],
    });
  }

  return ephemeralMessage("Use `/alert-channels list`, `set`, `unset`, or `test`.");
}

function alertChannelsListResponse(routes: DiscordNotificationChannel[]): DiscordInteractionResponse {
  return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
    flags: DISCORD_FLAG_EPHEMERAL,
    embeds: [
      {
        title: "Alert channel routes",
        description: routes.length === 0
          ? "No alert channels are configured yet."
          : "Configured bot delivery channels for this server.",
        color: BOT_COLOR,
        fields: routes.length > 0
          ? routes.map((route) => ({
            name: route.alertName,
            value: discordChannelMention(route.channelId),
          }))
          : [{ name: "No routes", value: "Use `/alert-channels set` to configure one." }],
      },
    ],
  });
}

function alertsListResponse(
  subscriptions: DiscordMemberAlertSubscriptionsResponse | null,
): DiscordInteractionResponse {
  const settings = subscriptions?.alerts ?? DISCORD_ALERTS
    .filter((alert) => alert.subscribable)
    .map<DiscordMemberAlertSubscriptionSetting>((alert) => ({
      key: alert.key,
      name: alert.name,
      description: alert.description,
      enabled: false,
    }));

  return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
    flags: DISCORD_FLAG_EPHEMERAL,
    embeds: [
      {
        title: "Available alert subscriptions",
        description: subscriptions
          ? `Use \`/alerts manage\`, \`/alerts subscribe\`, \`/alerts unsubscribe\`, or [Dashboard settings](${DASHBOARD_SETTINGS_URL}) to change your settings.`
          : `I cannot show your current status until your Discord account is linked to a Torn member. You can also use [Dashboard settings](${DASHBOARD_SETTINGS_URL}).`,
        color: BOT_COLOR,
        fields: settings.map(alertSettingField),
      },
    ],
  });
}

function alertsManageResponse(
  subscriptions: DiscordMemberAlertSubscriptionsResponse,
  responseType: number,
  description?: string,
  pendingAlertKeys?: Set<string>,
): DiscordInteractionResponse {
  const selectedAlertKeys = pendingAlertKeys ?? new Set(
    subscriptions.alerts.filter((alert) => alert.enabled).map((alert) => alert.key),
  );
  const enabledCount = selectedAlertKeys.size;
  return discordMessageResponse(responseType, {
    flags: DISCORD_FLAG_EPHEMERAL,
    embeds: [
      {
        title: "Manage alert subscriptions",
        description: description ?? (enabledCount === 0
          ? "Select alerts from the dropdown to subscribe yourself."
          : `You are subscribed to ${enabledCount} alert${enabledCount === 1 ? "" : "s"}. Update the dropdown to change them.`),
        color: BOT_COLOR,
      },
    ],
    components: alertSubscriptionComponents(subscriptions.alerts, selectedAlertKeys),
  });
}

function alertSubscriptionComponents(
  alerts: DiscordMemberAlertSubscriptionSetting[],
  selectedAlertKeys: Set<string>,
): DiscordComponent[] {
  return [
    {
      type: DISCORD_COMPONENT_ACTION_ROW,
      components: [
        {
          type: DISCORD_COMPONENT_STRING_SELECT,
          custom_id: DISCORD_COMPONENT_IDS.alertsManageSelect,
          placeholder: "Choose alert subscriptions",
          min_values: 0,
          max_values: alerts.length,
          options: alerts.map((alert) => ({
            label: alert.name,
            value: alert.key,
            description: fitDiscordSelectOptionDescription(alert.description),
            default: selectedAlertKeys.has(alert.key),
          })),
        },
      ],
    },
    {
      type: DISCORD_COMPONENT_ACTION_ROW,
      components: [
        {
          type: DISCORD_COMPONENT_BUTTON,
          style: DISCORD_BUTTON_SECONDARY,
          label: "Clear",
          custom_id: DISCORD_COMPONENT_IDS.alertsManageClear,
        },
        {
          type: DISCORD_COMPONENT_BUTTON,
          style: DISCORD_BUTTON_SUCCESS,
          label: "Submit",
          custom_id: `${DISCORD_COMPONENT_IDS.alertsManageSubmitPrefix}${encodeAlertSelection(alerts, selectedAlertKeys)}`,
        },
      ],
    },
  ];
}

function alertSettingField(alert: DiscordMemberAlertSubscriptionSetting): {
  name: string;
  value: string;
  inline?: boolean;
} {
  return {
    name: alert.enabled ? `${alert.name} - subscribed` : `${alert.name} - not subscribed`,
    value: alert.description,
  };
}

function fitDiscordSelectOptionDescription(description: string): string {
  return description.length <= DISCORD_SELECT_OPTION_DESCRIPTION_LIMIT
    ? description
    : `${description.slice(0, DISCORD_SELECT_OPTION_DESCRIPTION_LIMIT - 3).trimEnd()}...`;
}

function encodeAlertSelection(
  alerts: DiscordMemberAlertSubscriptionSetting[],
  selectedAlertKeys: Set<string>,
): string {
  let mask = 0n;
  alerts.forEach((alert, index) => {
    if (selectedAlertKeys.has(alert.key)) {
      mask |= 1n << BigInt(index);
    }
  });
  return mask.toString(16);
}

function decodeAlertSelection(
  alerts: DiscordMemberAlertSubscriptionSetting[],
  encoded: string,
): Set<string> {
  const mask = /^[0-9a-f]+$/i.test(encoded) ? BigInt(`0x${encoded}`) : 0n;
  return new Set(
    alerts
      .filter((_alert, index) => (mask & (1n << BigInt(index))) !== 0n)
      .map((alert) => alert.key),
  );
}

async function readActiveOrLatestWar(env: Env): Promise<WarSummaryForDiscord | null> {
  return await env.DB.prepare(
    `
    SELECT
      w.*,
      COALESCE(ws.attacks_vs_enemy_total, 0) AS attacks_vs_enemy_total,
      COALESCE(ws.attacks_from_enemy_total, 0) AS attacks_from_enemy_total,
      COALESCE(ws.outside_hits, 0) AS outside_hits,
      COALESCE(ws.total_respect_gain, 0) AS total_respect_gain,
      COALESCE(ws.total_respect_lost, 0) AS total_respect_lost,
      COALESCE(ws.unique_attackers, 0) AS unique_attackers,
      ws.first_attack_at,
      ws.last_attack_at,
      ws.updated_at AS summary_updated_at
    FROM wars w
    LEFT JOIN war_summary ws ON ws.war_id = w.id
    ORDER BY CASE WHEN w.status = 'active' THEN 0 ELSE 1 END, w.practical_start_time DESC, w.id DESC
    LIMIT 1
    `,
  ).first<WarSummaryForDiscord>();
}

async function readDiscordTravelTarget(env: Env): Promise<DiscordTravelTarget | null> {
  const war = await readActiveOrLatestWar(env);
  if (
    war &&
    war.enemy_faction_id !== null &&
    war.status !== "ended" &&
    war.practical_finish_time === null &&
    war.official_end_time === null
  ) {
    return {
      source: "war",
      factionId: war.enemy_faction_id,
      title: `${war.name} travel tracker`,
      war,
    };
  }

  const manualTarget = await env.DB.prepare(
    `
    SELECT faction_id, faction_name
    FROM discord_travel_tracker_target
    WHERE id = 1
      AND enabled = 1
    LIMIT 1
    `,
  ).first<DiscordTravelTrackerTargetRow>();

  if (!manualTarget) {
    return null;
  }

  const name = manualTarget.faction_name?.trim() || `Faction ${manualTarget.faction_id}`;
  return {
    source: "manual",
    factionId: manualTarget.faction_id,
    title: `${name} travel tracker`,
    war: null,
  };
}

async function readWarMemberLeaderboard(
  env: Env,
  warId: number,
  metric: string,
  limit: number,
): Promise<MemberLeaderboardRow[]> {
  const orderBy = metric === "attacks"
    ? "wms.attacks_vs_enemy_successful DESC, wms.attacks_vs_enemy_total DESC, wms.respect_gained DESC"
    : metric === "defends"
      ? "wms.defends_total DESC, wms.defends_won DESC, wms.respect_lost DESC"
      : metric === "outside"
        ? "wms.outside_hits DESC, wms.respect_gained DESC"
        : "wms.respect_gained DESC, wms.attacks_vs_enemy_successful DESC, wms.attacks_vs_enemy_total DESC";

  const result = await env.DB.prepare(
    `
    SELECT
      wms.member_id,
      wms.member_name,
      links.discord_user_id,
      wms.attacks_vs_enemy_total,
      wms.attacks_vs_enemy_successful,
      wms.respect_gained,
      wms.defends_total,
      wms.defends_won,
      wms.outside_hits
    FROM war_member_stats wms
    LEFT JOIN home_faction_members h ON h.member_id = wms.member_id
    LEFT JOIN discord_member_links links ON links.torn_user_id = wms.member_id
    WHERE wms.war_id = ?
      AND COALESCE(h.report_exempt, 0) = 0
    ORDER BY ${orderBy}, LOWER(wms.member_name), wms.member_id
    LIMIT ?
    `,
  ).bind(warId, limit).all<MemberLeaderboardRow>();

  return result.results ?? [];
}

async function readEnemyStatusSummary(env: Env, factionId: number): Promise<EnemyStatusSummaryRow> {
  const row = await env.DB.prepare(
    `
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN live.status_state = 'Okay' THEN 1 ELSE 0 END) AS okay,
      SUM(CASE WHEN live.status_state = 'Hospital' THEN 1 ELSE 0 END) AS hospital,
      SUM(CASE WHEN live.status_state = 'Traveling' THEN 1 ELSE 0 END) AS traveling,
      SUM(CASE WHEN live.status_state = 'Abroad' THEN 1 ELSE 0 END) AS abroad,
      SUM(CASE WHEN live.status_state IS NULL OR live.status_state = '' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN members.ff_battlestats IS NOT NULL THEN 1 ELSE 0 END) AS stats_available,
      AVG(members.level) AS average_level,
      AVG(members.ff_battlestats) AS average_ff_battlestats
    FROM enemy_faction_members members
    LEFT JOIN enemy_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
    `,
  ).bind(factionId).first<EnemyStatusSummaryRow>();

  return row ?? {
    total: 0,
    okay: 0,
    hospital: 0,
    traveling: 0,
    abroad: 0,
    unknown: 0,
    stats_available: 0,
    average_level: null,
    average_ff_battlestats: null,
  };
}

async function readTravelTrackerRows(
  env: Env,
  factionId: number,
  view: string,
  limit: number,
): Promise<TravelTrackerRow[]> {
  const statusFilter = view === "traveling"
    ? "AND live.status_state = 'Traveling'"
    : view === "abroad"
      ? "AND live.status_state = 'Abroad'"
      : "AND live.status_state IN ('Traveling', 'Abroad')";
  const result = await env.DB.prepare(
    `
    SELECT
      members.member_id,
      members.name,
      live.status_state,
      live.status_description,
      live.plane_image_type,
      live.travel_origin,
      live.travel_destination,
      live.travel_started_after,
      live.travel_started_before,
      live.estimated_arrival_at,
      live.estimated_arrival_earliest,
      live.estimated_arrival_latest,
      live.travel_trip_destination,
      live.travel_trip_type,
      live.travel_trip_inferred_at
    FROM enemy_faction_members members
    JOIN enemy_member_live_status live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
      ${statusFilter}
    ORDER BY
      CASE WHEN live.status_state = 'Traveling' THEN 0 ELSE 1 END,
      COALESCE(live.estimated_arrival_at, live.estimated_arrival_latest, 9223372036854775807),
      COALESCE(live.travel_trip_destination, live.travel_destination, live.status_description, ''),
      LOWER(members.name)
    LIMIT ?
    `,
  ).bind(factionId, limit).all<TravelTrackerRow>();

  return result.results ?? [];
}

async function readChainWatchForWar(env: Env, warId: number): Promise<ChainWatchDiscordRow | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM chain_watch_state
    WHERE war_id = ?
    LIMIT 1
    `,
  ).bind(warId).first<ChainWatchDiscordRow>();
}

function discordMessageResponse(
  responseType: number,
  data: {
    content?: string;
    embeds?: DiscordEmbed[];
    components?: DiscordComponent[];
    flags?: number;
  },
): DiscordInteractionResponse {
  return {
    type: responseType,
    data: {
      ...data,
      embeds: data.embeds?.map(fitDiscordEmbed),
      allowed_mentions: { parse: [] },
    },
  };
}

function ephemeralMessage(content: string): DiscordInteractionResponse {
  return discordMessageResponse(DISCORD_RESPONSE_CHANNEL_MESSAGE, {
    content,
    flags: DISCORD_FLAG_EPHEMERAL,
  });
}

function warComponents(env: Env, war: WarSummaryForDiscord): DiscordComponent[] {
  const buttons: DiscordComponent["components"] = [
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Summary", custom_id: DISCORD_COMPONENT_IDS.warCurrent },
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Members", custom_id: DISCORD_COMPONENT_IDS.warMembersRespect },
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Enemy", custom_id: DISCORD_COMPONENT_IDS.warEnemyStatus },
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Travel", custom_id: DISCORD_COMPONENT_IDS.travelCurrent },
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Chain", custom_id: DISCORD_COMPONENT_IDS.chainStatus },
  ];
  const dashboardUrl = dashboardWarUrl(env, war.name);
  if (dashboardUrl) {
    buttons.push({ type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_LINK, label: "Dashboard", url: dashboardUrl });
  }

  const rows: DiscordComponent[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({
      type: DISCORD_COMPONENT_ACTION_ROW,
      components: buttons.slice(index, index + 5),
    });
  }
  return rows;
}

function dashboardWarUrl(env: Env, warName: string): string | null {
  const base = env.DASHBOARD_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/wars/${encodeURIComponent(warName)}` : null;
}

function leaderboardLine(rank: number, member: MemberLeaderboardRow, metric: string): string {
  const label = member.discord_user_id ? `<@${member.discord_user_id}>` : cleanMemberName(member.member_name, member.member_id);
  const value = metric === "attacks"
    ? `${integerField(member.attacks_vs_enemy_successful)}/${integerField(member.attacks_vs_enemy_total)} attacks`
    : metric === "defends"
      ? `${integerField(member.defends_total)} defends, ${integerField(member.defends_won)} won`
      : metric === "outside"
        ? `${integerField(member.outside_hits)} outside`
        : `${numberField(member.respect_gained)} respect`;
  return `**${rank}.** ${label} - ${value}`;
}

function enemyFields(summary: EnemyStatusSummaryRow, view: string): DiscordEmbed["fields"] {
  if (view === "scouting") {
    return [
      { name: "Loaded members", value: integerField(summary.total), inline: true },
      { name: "Stats available", value: integerField(summary.stats_available), inline: true },
      { name: "Average level", value: numberField(summary.average_level), inline: true },
      { name: "Average FF stats", value: numberField(summary.average_ff_battlestats), inline: true },
    ];
  }

  return [
    { name: "Okay", value: integerField(summary.okay), inline: true },
    { name: "Hospital", value: integerField(summary.hospital), inline: true },
    { name: "Traveling", value: integerField(summary.traveling), inline: true },
    { name: "Abroad", value: integerField(summary.abroad), inline: true },
    { name: "Unknown", value: integerField(summary.unknown), inline: true },
    { name: "Loaded members", value: integerField(summary.total), inline: true },
  ];
}

function travelTrackerDescription(members: TravelTrackerRow[], view: string): string {
  if (members.length === 0) {
    return view === "traveling"
      ? "No enemy members are currently shown as traveling."
      : view === "abroad"
        ? "No enemy members are currently shown abroad."
        : "No enemy travelers or abroad members are currently shown.";
  }

  const normalizedView = view === "traveling" || view === "abroad" ? view : "all";
  return formatTravelTrackerSections(members, { view: normalizedView }).join("\n");
}

function chainAttackPair(chain: ChainWatchDiscordRow): string {
  const attacker = chain.last_hit_attacker_name?.trim() || "Unknown attacker";
  const defender = chain.last_hit_defender_name?.trim() || "Unknown defender";
  return `${attacker} v ${defender}${chain.last_hit_result ? ` (${chain.last_hit_result})` : ""}`;
}

function optionString(option: DiscordOption, name: string): string | null {
  const value = option.options?.find((item) => item.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function optionInteger(option: DiscordOption, name: string): number | null {
  const value = option.options?.find((item) => item.name === name)?.value;
  return Number.isInteger(value) ? value as number : null;
}

function alertOption(option: DiscordOption): typeof DISCORD_ALERTS[number] | null {
  const alertKey = optionString(option, "alert") ?? "";
  return discordAlertByKey(alertKey);
}

function interactionDiscordUserId(interaction: DiscordInteraction): string | null {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  return /^\d{5,32}$/.test(userId) ? userId : null;
}

function discordChannelMention(channelId: string): string {
  return `<#${channelId}>`;
}

function cleanMemberName(name: string | null, id: number): string {
  return name?.replace(/\s+/g, " ").trim() || `Torn ${id}`;
}

function fitDiscordEmbed(embed: DiscordEmbed): DiscordEmbed {
  return embed.description
    ? { ...embed, description: fitDiscordEmbedDescription(embed.description) }
    : embed;
}

function fitDiscordEmbedDescription(description: string): string {
  if (description.length <= DISCORD_EMBED_DESCRIPTION_SAFE_LIMIT) {
    return description;
  }

  const suffix = "\n...";
  const lines = description.split("\n");
  const fitted: string[] = [];
  let length = 0;

  for (const line of lines) {
    const separatorLength = fitted.length > 0 ? 1 : 0;
    const remaining = DISCORD_EMBED_DESCRIPTION_SAFE_LIMIT - suffix.length - length - separatorLength;
    if (remaining <= 0) {
      break;
    }

    if (line.length > remaining) {
      fitted.push(line.slice(0, remaining).trimEnd());
      break;
    }

    fitted.push(line);
    length += separatorLength + line.length;
  }

  const prefix = fitted.join("\n").trimEnd();
  return prefix ? `${prefix}${suffix}` : "...";
}

function logDiscordInteractionError(interaction: DiscordInteraction, error: unknown): void {
  console.error("Discord interaction failed", {
    type: interaction.type ?? null,
    command: interaction.data?.name ?? null,
    custom_id: interaction.data?.custom_id ?? null,
    guild_id: interaction.guild_id ?? null,
    channel_id: interaction.channel_id ?? null,
    error: error instanceof Error ? error.message : String(error),
  });
}

function integerField(value: unknown): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString("en-GB") : "0";
}

function numberField(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : "Unknown";
}

function discordTimestamp(timestamp: number): string {
  return `<t:${Math.floor(timestamp)}:R>`;
}

function nullableTimestamp(timestamp: number | null | undefined): string {
  return timestamp ? discordTimestamp(timestamp) : "Unknown";
}

function hexToBytes(hex: string): Uint8Array | null {
  const trimmed = hex.trim();
  if (!/^(?:[0-9a-f]{2})+$/i.test(trimmed)) {
    return null;
  }

  const bytes = new Uint8Array(trimmed.length / 2);
  for (let index = 0; index < trimmed.length; index += 2) {
    bytes[index / 2] = Number.parseInt(trimmed.slice(index, index + 2), 16);
  }
  return bytes;
}
