import { cleanString, positiveIntegerOrNull, readJsonObject } from "./backend/request";
import {
  type DiscordAllowedMentions,
} from "./discord";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { DISCORD_ALERT_KEYS, type DiscordAlertKey } from "./discordAlerts";
import { readDefaultDiscordNotificationChannel } from "./discordNotificationChannels";
import {
  HOME_FACTION_ID,
} from "./constants";
import {
  readCurrentScoutingWar,
  refreshHomeFactionMembers,
  refreshTrackedFactionMemberStatuses,
} from "./enemyScouting";
import {
  formatTravelTrackerSections,
  travelCounts,
  type DiscordTravelRow,
} from "./discordTravelFormatting";
import { Env } from "./types";
import { d1Changes, json, nowSeconds } from "./utils";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";

const TARGET_TRAVEL_TRACKER_COLOR = 0xeb5757;
const HOME_TRAVEL_TRACKER_COLOR = 0x27ae60;
const TRAVEL_TRACKER_INACTIVE_COLOR = 0x778899;
const TRAVEL_TRACKER_LIMIT = 18;
const TRAVEL_TRACKER_TARGET_ID = 1;
const TRAVEL_TRACKER_EMBED_SAFE_LIMIT = 3900;
const TARGET_TRACKER_KEY = "target";
const HOME_TRACKER_KEY = "home";
const HOME_TRACKER_TITLE = "Buttgrass Travel Tracker";
const MISSING_TRAVEL_TRACKER_DESTINATION_REASON =
  "Discord travel tracker route or DISCORD_TRAVEL_TRACKER_WEBHOOK_URL/DISCORD_WEBHOOK_URL is not configured";

type DiscordTravelTrackerState = {
  tracker_key: TravelTrackerKey;
  enabled: number;
  war_id: number | null;
  target_source: string | null;
  faction_id: number | null;
  destination_key: string | null;
  message_id: string | null;
  content_hash: string | null;
  last_synced_at: number | null;
};

type DiscordTravelTrackerTarget = {
  id: number;
  faction_id: number;
  faction_name: string | null;
  enabled: number;
  last_refreshed_at: number | null;
};

type TravelTrackerKey = typeof TARGET_TRACKER_KEY | typeof HOME_TRACKER_KEY;
type TravelTrackerSource = "war" | "manual" | "home" | "inactive";

type TravelTrackerTarget =
  | {
      source: "war";
      warId: number;
      factionId: number;
      name: string;
      manualTarget: null;
    }
  | {
      source: "manual";
      warId: null;
      factionId: number;
      name: string;
      manualTarget: DiscordTravelTrackerTarget;
    }
  | {
      source: "home";
      warId: null;
      factionId: number;
      name: string;
      manualTarget: null;
    };

type TravelTrackerRow = DiscordTravelRow;

export type DiscordTravelTrackerChannelSyncResult = {
  ok: true;
  tracker_key: TravelTrackerKey;
  enabled: boolean;
  skipped: boolean;
  reason?: string;
  war_id: number | null;
  faction_id: number | null;
  source: TravelTrackerSource;
  message_id: string | null;
  traveling: number;
  abroad: number;
  changed: boolean;
  refreshed?: unknown;
};

export type DiscordTravelTrackerSyncResult = DiscordTravelTrackerChannelSyncResult & {
  target: DiscordTravelTrackerChannelSyncResult;
  home: DiscordTravelTrackerChannelSyncResult;
};

export async function syncDiscordTravelTrackerFromRequest(env: Env): Promise<Response> {
  return json(await syncDiscordTravelTracker(env, { force: true }));
}

export async function getDiscordTravelTrackerTargetFromRequest(env: Env): Promise<Response> {
  const [target, war, targetState, homeState] = await Promise.all([
    readTravelTrackerTarget(env),
    readCurrentScoutingWar(env),
    readTravelTrackerState(env, TARGET_TRACKER_KEY),
    readTravelTrackerState(env, HOME_TRACKER_KEY),
  ]);
  const checkedAt = nowSeconds();
  const activeWar = isActiveDiscordTravelWar(war, checkedAt)
    ? {
        war_id: war.id,
        faction_id: war.enemy_faction_id,
        name: war.name,
      }
    : null;
  const activeSource = activeWar ? "war" : target ? "manual" : "inactive";
  const serializedTarget = serializeTravelTrackerTarget(target);

  return json({
    ok: true,
    active_source: activeSource,
    war_target: activeWar,
    manual_target: serializedTarget,
    target_tracker: {
      enabled: trackerEnabled(TARGET_TRACKER_KEY, targetState),
      active_source: activeSource,
      war_target: activeWar,
      manual_target: serializedTarget,
      message_id: targetState?.message_id ?? null,
      last_synced_at: targetState?.last_synced_at ?? null,
    },
    home_tracker: {
      enabled: trackerEnabled(HOME_TRACKER_KEY, homeState),
      faction_id: HOME_FACTION_ID,
      message_id: homeState?.message_id ?? null,
      last_synced_at: homeState?.last_synced_at ?? null,
    },
  });
}

export async function updateDiscordTravelTrackerSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const targetEnabled = optionalBoolean(body.target_enabled);
  const homeEnabled = optionalBoolean(body.home_enabled);

  if (targetEnabled === undefined && homeEnabled === undefined) {
    return json({ ok: false, error: "target_enabled or home_enabled is required", code: "INVALID_TRACKER_SETTINGS" }, 400);
  }

  if (targetEnabled !== undefined) {
    await setTravelTrackerEnabled(env, TARGET_TRACKER_KEY, targetEnabled);
  }
  if (homeEnabled !== undefined) {
    await setTravelTrackerEnabled(env, HOME_TRACKER_KEY, homeEnabled);
  }

  const sync = await syncDiscordTravelTracker(env, { force: true });
  return json({
    ok: true,
    target_enabled: sync.target.enabled,
    home_enabled: sync.home.enabled,
    sync,
  });
}

export async function enableDiscordTargetTravelTracker(env: Env): Promise<void> {
  await setTravelTrackerEnabled(env, TARGET_TRACKER_KEY, true);
}

export async function enableDiscordTravelTrackersForWar(env: Env): Promise<void> {
  await Promise.all([
    setTravelTrackerEnabled(env, TARGET_TRACKER_KEY, true),
    setTravelTrackerEnabled(env, HOME_TRACKER_KEY, true),
  ]);
}

export async function stopDiscordTravelTrackersForWar(env: Env): Promise<void> {
  await Promise.all([
    setTravelTrackerEnabled(env, TARGET_TRACKER_KEY, false),
    setTravelTrackerEnabled(env, HOME_TRACKER_KEY, false),
  ]);
  await syncDiscordTravelTracker(env, { force: true });
}

export async function setDiscordTravelTrackerTargetFromRequest(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const factionId = positiveIntegerOrNull(body.faction_id);
  if (factionId === null) {
    return json({ ok: false, error: "A valid faction_id is required", code: "INVALID_FACTION_ID" }, 400);
  }

  const factionName = cleanString(body.faction_name);
  await saveTravelTrackerTarget(env, factionId, factionName);
  const target = await readTravelTrackerTarget(env);
  const sync = await syncDiscordTravelTracker(env, { force: true });
  return json({
    ok: true,
    target: serializeTravelTrackerTarget(target),
    sync,
  });
}

export async function clearDiscordTravelTrackerTargetFromRequest(env: Env): Promise<Response> {
  const result = await clearTravelTrackerTarget(env);
  const sync = await syncDiscordTravelTracker(env, { force: true });
  return json({
    ok: true,
    cleared: d1Changes(result),
    sync,
  });
}

export async function syncDiscordTravelTracker(
  env: Env,
  options: { force?: boolean; scheduledTime?: number; manualOnly?: boolean; skipHomeRefresh?: boolean } = {},
): Promise<DiscordTravelTrackerSyncResult> {
  const [targetState, homeState] = await Promise.all([
    readTravelTrackerState(env, TARGET_TRACKER_KEY),
    readTravelTrackerState(env, HOME_TRACKER_KEY),
  ]);
  const destination = await readTravelTrackerDestination(env);
  const checkedAt = options.scheduledTime ? Math.floor(options.scheduledTime / 1000) : nowSeconds();

  if (!destination) {
    return combinedTrackerResult(
      trackerResult(TARGET_TRACKER_KEY, trackerEnabled(TARGET_TRACKER_KEY, targetState), true, MISSING_TRAVEL_TRACKER_DESTINATION_REASON, null, null, "inactive", targetState?.message_id ?? null, 0, 0, false),
      trackerResult(HOME_TRACKER_KEY, trackerEnabled(HOME_TRACKER_KEY, homeState), true, MISSING_TRAVEL_TRACKER_DESTINATION_REASON, null, HOME_FACTION_ID, "inactive", homeState?.message_id ?? null, 0, 0, false),
    );
  }

  const targetResult = await syncTargetTravelTracker(env, targetState, destination, checkedAt, options);
  const homeResult = await syncHomeTravelTracker(env, homeState, destination, checkedAt, {
    force: options.force ?? false,
    skipRefresh: options.skipHomeRefresh ?? false,
  });
  return combinedTrackerResult(targetResult, homeResult);
}

async function syncTargetTravelTracker(
  env: Env,
  state: DiscordTravelTrackerState | null,
  destination: TravelTrackerDestination,
  checkedAt: number,
  options: { force?: boolean; manualOnly?: boolean },
): Promise<DiscordTravelTrackerChannelSyncResult> {
  const enabled = trackerEnabled(TARGET_TRACKER_KEY, state);
  const canDeliver = travelTrackerDeliveryAvailable(destination, TARGET_TRACKER_KEY);
  if (!enabled) {
    if (state?.message_id && options.force && canDeliver) {
      return stopTravelTrackerMessage(env, TARGET_TRACKER_KEY, state, destination, checkedAt, "target travel tracker disabled");
    }
    return trackerResult(TARGET_TRACKER_KEY, enabled, true, "target travel tracker disabled", null, null, "inactive", state?.message_id ?? null, 0, 0, false);
  }
  if (!canDeliver) {
    return trackerResult(TARGET_TRACKER_KEY, enabled, true, MISSING_TRAVEL_TRACKER_DESTINATION_REASON, null, null, "inactive", state?.message_id ?? null, 0, 0, false);
  }

  const target = await resolveTravelTrackerTarget(env, checkedAt);
  if (options.manualOnly && target?.source !== "manual") {
    return trackerResult(
      TARGET_TRACKER_KEY,
      enabled,
      true,
      "manual travel tracker not active",
      target?.warId ?? null,
      target?.factionId ?? null,
      target?.source ?? "inactive",
      state?.message_id ?? null,
      0,
      0,
      false,
    );
  }

  if (!target) {
    if (!state?.message_id) {
      return trackerResult(TARGET_TRACKER_KEY, enabled, true, "no active travel tracker target", null, null, "inactive", null, 0, 0, false);
    }
    return stopTravelTrackerMessage(env, TARGET_TRACKER_KEY, state, destination, checkedAt, "no active travel tracker target");
  }

  const refreshed = target.source === "manual"
    ? await refreshManualTravelTrackerTarget(env, target)
    : undefined;
  const members = await readTravelTrackerRows(env, TARGET_TRACKER_KEY, target.factionId);
  return updateTravelTrackerMessage(env, TARGET_TRACKER_KEY, state, destination, target, members, checkedAt, options.force ?? false, refreshed);
}

async function syncHomeTravelTracker(
  env: Env,
  state: DiscordTravelTrackerState | null,
  destination: TravelTrackerDestination,
  checkedAt: number,
  options: { force: boolean; skipRefresh: boolean },
): Promise<DiscordTravelTrackerChannelSyncResult> {
  const enabled = trackerEnabled(HOME_TRACKER_KEY, state);
  const canDeliver = travelTrackerDeliveryAvailable(destination, HOME_TRACKER_KEY);
  if (!enabled) {
    if (state?.message_id && options.force && canDeliver) {
      return stopTravelTrackerMessage(env, HOME_TRACKER_KEY, state, destination, checkedAt, "home travel tracker disabled");
    }
    return trackerResult(HOME_TRACKER_KEY, enabled, true, "home travel tracker disabled", null, HOME_FACTION_ID, "home", state?.message_id ?? null, 0, 0, false);
  }
  if (!canDeliver) {
    return trackerResult(HOME_TRACKER_KEY, enabled, true, MISSING_TRAVEL_TRACKER_DESTINATION_REASON, null, HOME_FACTION_ID, "home", state?.message_id ?? null, 0, 0, false);
  }

  const target: TravelTrackerTarget = {
    source: "home",
    warId: null,
    factionId: HOME_FACTION_ID,
    name: "Home faction",
    manualTarget: null,
  };
  let refreshed: unknown;
  if (!options.skipRefresh) {
    try {
      const members = await refreshHomeFactionMembers(env);
      refreshed = { fetchedMembers: members.length };
    } catch (err: any) {
      console.warn("Home travel tracker refresh failed:", err?.message || err);
      refreshed = { skipped: true, reason: "home refresh failed" };
    }
  }
  const members = await readTravelTrackerRows(env, HOME_TRACKER_KEY, HOME_FACTION_ID);
  return updateTravelTrackerMessage(env, HOME_TRACKER_KEY, state, destination, target, members, checkedAt, options.force, refreshed);
}

async function stopTravelTrackerMessage(
  env: Env,
  trackerKey: TravelTrackerKey,
  state: DiscordTravelTrackerState,
  destination: TravelTrackerDestination,
  checkedAt: number,
  reason: string,
): Promise<DiscordTravelTrackerChannelSyncResult> {
  const message = buildStoppedTravelTrackerMessage(trackerKey, checkedAt, reason);
  const hash = contentHash(message.content);
  const enabled = trackerEnabled(trackerKey, state);

  if (state.content_hash === hash) {
    await markTravelTrackerChecked(env, trackerKey, checkedAt);
    return trackerResult(trackerKey, enabled, true, "travel tracker unchanged", state.war_id, state.faction_id, "inactive", state.message_id, 0, 0, false);
  }

  const messageId = await editExistingTravelTrackerMessage(env, trackerKey, state.message_id!, destination, message);
  await saveTravelTrackerState(env, {
    trackerKey,
    enabled,
    source: "inactive",
    warId: state.war_id,
    factionId: state.faction_id,
    destinationKey: destination.key,
    messageId,
    contentHash: hash,
    checkedAt,
  });

  return trackerResult(trackerKey, enabled, false, reason, state.war_id, state.faction_id, "inactive", messageId, 0, 0, true);
}

async function updateTravelTrackerMessage(
  env: Env,
  trackerKey: TravelTrackerKey,
  state: DiscordTravelTrackerState | null,
  destination: TravelTrackerDestination,
  target: TravelTrackerTarget | null,
  members: TravelTrackerRow[],
  checkedAt: number,
  force: boolean,
  refreshed?: unknown,
): Promise<DiscordTravelTrackerChannelSyncResult> {
  const message = buildTravelTrackerMessage(target, members, checkedAt);
  const hash = contentHash(message.content);
  const { traveling, abroad } = travelCounts(members);
  const existingMessageId = state?.message_id ?? null;
  const warId = target?.warId ?? null;
  const factionId = target?.factionId ?? null;
  const source = target?.source ?? "inactive";
  const enabled = trackerEnabled(trackerKey, state);
  const sameTarget = isSameTrackerTarget(state, source, warId, factionId, destination.key);
  const reusableMessageId = sameTarget ? existingMessageId : null;

  if (!force && reusableMessageId && state?.content_hash === hash) {
    await markTravelTrackerChecked(env, trackerKey, checkedAt);
    return trackerResult(trackerKey, enabled, true, "travel tracker unchanged", warId, factionId, source, reusableMessageId, traveling, abroad, false, refreshed);
  }

  const messageId = reusableMessageId
    ? await editExistingTravelTrackerMessage(env, trackerKey, reusableMessageId, destination, message)
    : await createTravelTrackerMessage(env, trackerKey, destination, message);

  await saveTravelTrackerState(env, {
    trackerKey,
    enabled,
    source,
    warId,
    factionId,
    destinationKey: destination.key,
    messageId,
    contentHash: hash,
    checkedAt,
  });

  return trackerResult(trackerKey, enabled, false, undefined, warId, factionId, source, messageId, traveling, abroad, true, refreshed);
}

async function editExistingTravelTrackerMessage(
  env: Env,
  trackerKey: TravelTrackerKey,
  messageId: string,
  destination: TravelTrackerDestination,
  message: { content: string; color: number },
): Promise<string | null> {
  return await upsertDiscordAlertMessage(
    env,
    travelTrackerAlertKey(trackerKey),
    messageId,
    message.content,
    emptyAllowedMentions(),
    { embedColor: message.color, webhookUrl: destination.webhookUrl },
  );
}

async function createTravelTrackerMessage(
  env: Env,
  trackerKey: TravelTrackerKey,
  destination: TravelTrackerDestination,
  message: { content: string; color: number },
): Promise<string | null> {
  return upsertDiscordAlertMessage(
    env,
    travelTrackerAlertKey(trackerKey),
    null,
    message.content,
    emptyAllowedMentions(),
    { embedColor: message.color, webhookUrl: destination.webhookUrl },
  );
}

function travelTrackerAlertKey(trackerKey: TravelTrackerKey): DiscordAlertKey {
  return trackerKey === HOME_TRACKER_KEY
    ? DISCORD_ALERT_KEYS.homeTravelTracker
    : DISCORD_ALERT_KEYS.targetTravelTracker;
}

function emptyAllowedMentions(): DiscordAllowedMentions {
  return { users: [], roles: [] };
}

function buildTravelTrackerMessage(
  target: TravelTrackerTarget | null,
  members: TravelTrackerRow[],
  checkedAt: number,
): { content: string; color: number } {
  if (!target) {
    return {
      color: TRAVEL_TRACKER_INACTIVE_COLOR,
      content: [
        "Target Travel Tracker: inactive",
        `No active war-room or manual faction travel tracking. Last checked <t:${checkedAt}:R>.`,
      ].join("\n"),
    };
  }

  const { traveling, abroad } = travelCounts(members);
  const title = target.source === "home"
    ? HOME_TRACKER_TITLE
    : `${target.name} Travel Tracker`;
  const lines = [
    title,
    `Updated <t:${checkedAt}:R> | ${traveling} traveling | ${abroad} abroad | ${target.factionId}`,
    "",
    ...formatTravelTrackerSections(members, { includeEmptySections: true }),
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");

  return {
    color: target.source === "home" ? HOME_TRAVEL_TRACKER_COLOR : TARGET_TRAVEL_TRACKER_COLOR,
    content: fitDiscordMessage(lines.join("\n")),
  };
}

function buildStoppedTravelTrackerMessage(
  trackerKey: TravelTrackerKey,
  checkedAt: number,
  reason: string,
): { content: string; color: number } {
  const title = trackerKey === HOME_TRACKER_KEY
    ? `${HOME_TRACKER_TITLE}: stopped`
    : "Target Travel Tracker: stopped";

  return {
    color: TRAVEL_TRACKER_INACTIVE_COLOR,
    content: [
      title,
      `Tracking stopped <t:${checkedAt}:R>.`,
      reason,
    ].join("\n"),
  };
}

function isSameTrackerTarget(
  state: DiscordTravelTrackerState | null,
  source: TravelTrackerSource,
  warId: number | null,
  factionId: number | null,
  destinationKey: string,
): boolean {
  if (!state?.message_id) {
    return false;
  }

  if (state.target_source === null && state.faction_id === null) {
    return source === "war" && state.war_id === warId && state.destination_key === destinationKey;
  }

  return state.target_source === source &&
    state.war_id === warId &&
    state.faction_id === factionId &&
    state.destination_key === destinationKey;
}

type TravelTrackerDestination = {
  webhookUrl?: string;
  key: string;
  routedAlertKeys: Set<DiscordAlertKey>;
};

async function readTravelTrackerDestination(env: Env): Promise<TravelTrackerDestination | null> {
  const webhookUrl = env.DISCORD_TRAVEL_TRACKER_WEBHOOK_URL?.trim() || env.DISCORD_WEBHOOK_URL?.trim();
  const routedAlertKeys = new Set<DiscordAlertKey>();
  await Promise.all([
    addRoutedTravelTrackerAlertKey(env, routedAlertKeys, DISCORD_ALERT_KEYS.targetTravelTracker),
    addRoutedTravelTrackerAlertKey(env, routedAlertKeys, DISCORD_ALERT_KEYS.homeTravelTracker),
  ]);
  if (!webhookUrl && routedAlertKeys.size === 0) {
    return null;
  }

  return {
    webhookUrl: webhookUrl || undefined,
    routedAlertKeys,
    key: webhookUrl
      ? contentHash(webhookUrl)
      : `discord-bot-route:${Array.from(routedAlertKeys).sort().join(",")}`,
  };
}

async function addRoutedTravelTrackerAlertKey(
  env: Env,
  routedAlertKeys: Set<DiscordAlertKey>,
  alertKey: DiscordAlertKey,
): Promise<void> {
  if (await readDefaultDiscordNotificationChannel(env, alertKey)) {
    routedAlertKeys.add(alertKey);
  }
}

function travelTrackerDeliveryAvailable(destination: TravelTrackerDestination, trackerKey: TravelTrackerKey): boolean {
  return Boolean(destination.webhookUrl || destination.routedAlertKeys.has(travelTrackerAlertKey(trackerKey)));
}

async function resolveTravelTrackerTarget(env: Env, checkedAt: number): Promise<TravelTrackerTarget | null> {
  const war = await readCurrentScoutingWar(env);
  if (isActiveDiscordTravelWar(war, checkedAt)) {
    return {
      source: "war",
      warId: war.id,
      factionId: war.enemy_faction_id,
      name: war.name,
      manualTarget: null,
    };
  }

  const manualTarget = await readTravelTrackerTarget(env);
  if (!manualTarget) {
    return null;
  }

  return {
    source: "manual",
    warId: null,
    factionId: manualTarget.faction_id,
    name: manualTarget.faction_name ?? `Faction ${manualTarget.faction_id}`,
    manualTarget,
  };
}

function isActiveDiscordTravelWar(
  war: Awaited<ReturnType<typeof readCurrentScoutingWar>>,
  checkedAt: number,
): war is NonNullable<typeof war> {
  return Boolean(war && war.status !== "ended" && isWarRoomMemberTrackingActive(war, checkedAt));
}

async function refreshManualTravelTrackerTarget(
  env: Env,
  target: Extract<TravelTrackerTarget, { source: "manual" }>,
): Promise<unknown> {
  const refresh = await refreshTrackedFactionMemberStatuses(
    env,
    target.factionId,
    target.manualTarget.last_refreshed_at,
  );

  if (refresh.fetchedAt !== null) {
    await markTravelTrackerTargetRefreshed(env, refresh.fetchedAt);
  }

  return refresh;
}

async function readTravelTrackerRows(
  env: Env,
  trackerKey: TravelTrackerKey,
  factionId: number,
): Promise<TravelTrackerRow[]> {
  const memberTableName = trackerKey === HOME_TRACKER_KEY ? "home_faction_members" : "enemy_faction_members";
  const liveTableName = trackerKey === HOME_TRACKER_KEY ? "home_member_live_status" : "enemy_member_live_status";
  const currentFilter = trackerKey === HOME_TRACKER_KEY ? "AND members.is_current = 1" : "";
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
    FROM ${memberTableName} members
    JOIN ${liveTableName} live
      ON live.member_id = members.member_id
     AND live.faction_id = members.faction_id
    WHERE members.faction_id = ?
      ${currentFilter}
      AND live.status_state IN ('Traveling', 'Abroad')
    ORDER BY
      CASE WHEN live.status_state = 'Traveling' THEN 0 ELSE 1 END,
      COALESCE(live.estimated_arrival_at, live.estimated_arrival_latest, 9223372036854775807),
      COALESCE(live.travel_trip_destination, live.travel_destination, live.status_description, ''),
      LOWER(members.name)
    LIMIT ?
    `,
  ).bind(factionId, TRAVEL_TRACKER_LIMIT).all<TravelTrackerRow>();

  return result.results ?? [];
}

async function readTravelTrackerState(
  env: Env,
  trackerKey: TravelTrackerKey,
): Promise<DiscordTravelTrackerState | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM discord_travel_tracker_state
    WHERE tracker_key = ?
    LIMIT 1
    `,
  ).bind(trackerKey).first<DiscordTravelTrackerState>();
}

async function readTravelTrackerTarget(env: Env): Promise<DiscordTravelTrackerTarget | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM discord_travel_tracker_target
    WHERE id = ?
      AND enabled = 1
    LIMIT 1
    `,
  ).bind(TRAVEL_TRACKER_TARGET_ID).first<DiscordTravelTrackerTarget>();
}

async function saveTravelTrackerTarget(
  env: Env,
  factionId: number,
  factionName: string | null,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO discord_travel_tracker_target (
      id,
      faction_id,
      faction_name,
      enabled,
      last_refreshed_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 1, NULL, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      faction_id = excluded.faction_id,
      faction_name = excluded.faction_name,
      enabled = 1,
      last_refreshed_at = CASE
        WHEN discord_travel_tracker_target.faction_id = excluded.faction_id
          THEN discord_travel_tracker_target.last_refreshed_at
        ELSE NULL
      END,
      updated_at = unixepoch()
    `,
  ).bind(TRAVEL_TRACKER_TARGET_ID, factionId, factionName).run();
}

async function clearTravelTrackerTarget(env: Env): Promise<D1Result> {
  return await env.DB.prepare(
    `
    DELETE FROM discord_travel_tracker_target
    WHERE id = ?
    `,
  ).bind(TRAVEL_TRACKER_TARGET_ID).run();
}

async function markTravelTrackerTargetRefreshed(env: Env, refreshedAt: number): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE discord_travel_tracker_target
    SET last_refreshed_at = ?,
        updated_at = unixepoch()
    WHERE id = ?
    `,
  ).bind(refreshedAt, TRAVEL_TRACKER_TARGET_ID).run();
}

async function markTravelTrackerChecked(
  env: Env,
  trackerKey: TravelTrackerKey,
  checkedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE discord_travel_tracker_state
    SET last_synced_at = ?,
        updated_at = unixepoch()
    WHERE tracker_key = ?
    `,
  ).bind(checkedAt, trackerKey).run();
}

async function saveTravelTrackerState(
  env: Env,
  input: {
    trackerKey: TravelTrackerKey;
    enabled: boolean;
    source: TravelTrackerSource;
    warId: number | null;
    factionId: number | null;
    destinationKey: string;
    messageId: string | null;
    contentHash: string;
    checkedAt: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO discord_travel_tracker_state (
      tracker_key,
      enabled,
      war_id,
      target_source,
      faction_id,
      destination_key,
      message_id,
      content_hash,
      last_synced_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(tracker_key) DO UPDATE SET
      enabled = excluded.enabled,
      war_id = excluded.war_id,
      target_source = excluded.target_source,
      faction_id = excluded.faction_id,
      destination_key = excluded.destination_key,
      message_id = excluded.message_id,
      content_hash = excluded.content_hash,
      last_synced_at = excluded.last_synced_at,
      updated_at = unixepoch()
    `,
  ).bind(
    input.trackerKey,
    input.enabled ? 1 : 0,
    input.warId,
    input.source,
    input.factionId,
    input.destinationKey,
    input.messageId,
    input.contentHash,
    input.checkedAt,
  ).run();
}

function serializeTravelTrackerTarget(target: DiscordTravelTrackerTarget | null): Record<string, unknown> | null {
  if (!target) {
    return null;
  }

  return {
    faction_id: target.faction_id,
    faction_name: target.faction_name,
    enabled: target.enabled === 1,
    last_refreshed_at: target.last_refreshed_at,
  };
}

async function setTravelTrackerEnabled(
  env: Env,
  trackerKey: TravelTrackerKey,
  enabled: boolean,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO discord_travel_tracker_state (
      tracker_key,
      enabled,
      created_at,
      updated_at
    )
    VALUES (?, ?, unixepoch(), unixepoch())
    ON CONFLICT(tracker_key) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = unixepoch()
    `,
  ).bind(trackerKey, enabled ? 1 : 0).run();
}

function trackerEnabled(
  trackerKey: TravelTrackerKey,
  state: DiscordTravelTrackerState | null,
): boolean {
  if (state) {
    return state.enabled === 1;
  }

  return trackerKey === TARGET_TRACKER_KEY;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === "0" || value === "false") {
    return false;
  }
  return undefined;
}

function combinedTrackerResult(
  target: DiscordTravelTrackerChannelSyncResult,
  home: DiscordTravelTrackerChannelSyncResult,
): DiscordTravelTrackerSyncResult {
  return {
    ...target,
    target,
    home,
  };
}

function trackerResult(
  trackerKey: TravelTrackerKey,
  enabled: boolean,
  skipped: boolean,
  reason: string | undefined,
  warId: number | null,
  factionId: number | null,
  source: TravelTrackerSource,
  messageId: string | null,
  traveling: number,
  abroad: number,
  changed: boolean,
  refreshed?: unknown,
): DiscordTravelTrackerChannelSyncResult {
  return {
    ok: true,
    tracker_key: trackerKey,
    enabled,
    skipped,
    ...(reason ? { reason } : {}),
    war_id: warId,
    faction_id: factionId,
    source,
    message_id: messageId,
    traveling,
    abroad,
    changed,
    ...(refreshed ? { refreshed } : {}),
  };
}

function contentHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

function fitDiscordMessage(message: string): string {
  if (message.length <= TRAVEL_TRACKER_EMBED_SAFE_LIMIT) {
    return message;
  }

  const suffix = "\n...";
  const lines = message.split("\n");
  const fitted: string[] = [];
  let length = 0;

  for (const line of lines) {
    const nextLength = length + (fitted.length > 0 ? 1 : 0) + line.length;
    if (nextLength + suffix.length > TRAVEL_TRACKER_EMBED_SAFE_LIMIT) {
      break;
    }

    fitted.push(line);
    length = nextLength;
  }

  return `${fitted.join("\n").trimEnd()}${suffix}`;
}
