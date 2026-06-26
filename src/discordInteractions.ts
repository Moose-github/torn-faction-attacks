import { isRecord } from "./backend/request";
import { DISCORD_COMMAND_NAMES, DISCORD_COMPONENT_IDS } from "./discordCommands";
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
const DISCORD_BUTTON_PRIMARY = 1;
const DISCORD_BUTTON_LINK = 5;
const BOT_COLOR = 0x2f80ed;
const WARNING_COLOR = 0xffa500;

type DiscordInteraction = {
  type?: number;
  data?: {
    name?: string;
    custom_id?: string;
    options?: DiscordOption[];
  };
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
  components: Array<{
    type: number;
    style: number;
    label: string;
    custom_id?: string;
    url?: string;
  }>;
};

type WarSummaryForDiscord = WarRow & Partial<WarSummaryRow> & {
  summary_updated_at: number | null;
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

  const response = await handleVerifiedDiscordInteraction(interaction, env);
  return json(response);
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
    return routeDiscordComponent(interaction.data?.custom_id ?? "", env);
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
    return warEnemyResponse(env, optionString(subcommand, "view") ?? "status");
  }

  if (command === DISCORD_COMMAND_NAMES.chain && subcommand?.name === "status") {
    return chainStatusResponse(env, DISCORD_RESPONSE_CHANNEL_MESSAGE);
  }

  if (command === DISCORD_COMMAND_NAMES.bot && subcommand?.name === "help") {
    return botHelpResponse();
  }

  return ephemeralMessage("I do not know that command yet.");
}

async function routeDiscordComponent(customId: string, env: Env): Promise<DiscordInteractionResponse> {
  if (customId === DISCORD_COMPONENT_IDS.warCurrent) {
    return warCurrentResponse(env, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.warMembersRespect) {
    return warMembersResponse(env, "respect", 10, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.warEnemyStatus) {
    return warEnemyResponse(env, "status", DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  if (customId === DISCORD_COMPONENT_IDS.chainStatus) {
    return chainStatusResponse(env, DISCORD_RESPONSE_UPDATE_MESSAGE);
  }

  return ephemeralMessage("That Discord button is no longer supported.");
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
    embeds: [
      {
        title: "Torn war room bot",
        description: [
          "`/war current` - active or latest war summary",
          "`/war members` - member leaderboard",
          "`/war enemy` - enemy status, travel, or scouting summary",
          "`/chain status` - chain watch status",
        ].join("\n"),
        color: BOT_COLOR,
      },
    ],
  });
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
    LEFT JOIN member_discord_links links ON links.torn_user_id = wms.member_id
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
      SUM(CASE WHEN status_state = 'Okay' THEN 1 ELSE 0 END) AS okay,
      SUM(CASE WHEN status_state = 'Hospital' THEN 1 ELSE 0 END) AS hospital,
      SUM(CASE WHEN status_state = 'Traveling' THEN 1 ELSE 0 END) AS traveling,
      SUM(CASE WHEN status_state = 'Abroad' THEN 1 ELSE 0 END) AS abroad,
      SUM(CASE WHEN status_state IS NULL OR status_state = '' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN ff_battlestats IS NOT NULL THEN 1 ELSE 0 END) AS stats_available,
      AVG(level) AS average_level,
      AVG(ff_battlestats) AS average_ff_battlestats
    FROM enemy_faction_members
    WHERE faction_id = ?
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
    { type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_PRIMARY, label: "Chain", custom_id: DISCORD_COMPONENT_IDS.chainStatus },
  ];
  const dashboardUrl = dashboardWarUrl(env, war.name);
  if (dashboardUrl) {
    buttons.push({ type: DISCORD_COMPONENT_BUTTON, style: DISCORD_BUTTON_LINK, label: "Dashboard", url: dashboardUrl });
  }

  return [{ type: DISCORD_COMPONENT_ACTION_ROW, components: buttons }];
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
  if (view === "travel") {
    return [
      { name: "Traveling", value: integerField(summary.traveling), inline: true },
      { name: "Abroad", value: integerField(summary.abroad), inline: true },
      { name: "Loaded members", value: integerField(summary.total), inline: true },
    ];
  }

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

function cleanMemberName(name: string | null, id: number): string {
  return name?.replace(/\s+/g, " ").trim() || `Torn ${id}`;
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

