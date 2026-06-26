import { cleanString, positiveIntegerOrNull, readJsonObject } from "./backend/request";
import {
  createDiscordWebhookMessage,
  editDiscordWebhookMessage,
} from "./discord";
import {
  readCurrentScoutingWar,
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

const TRAVEL_TRACKER_STATE_ID = 1;
const TRAVEL_TRACKER_COLOR = 0x2f80ed;
const TRAVEL_TRACKER_INACTIVE_COLOR = 0x778899;
const TRAVEL_TRACKER_LIMIT = 18;
const TRAVEL_TRACKER_TARGET_ID = 1;

type DiscordTravelTrackerState = {
  id: number;
  war_id: number | null;
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
    };

type TravelTrackerRow = DiscordTravelRow;

export type DiscordTravelTrackerSyncResult = {
  ok: true;
  skipped: boolean;
  reason?: string;
  war_id: number | null;
  faction_id: number | null;
  source: "war" | "manual" | "inactive";
  message_id: string | null;
  traveling: number;
  abroad: number;
  changed: boolean;
  refreshed?: unknown;
};

export async function syncDiscordTravelTrackerFromRequest(env: Env): Promise<Response> {
  return json(await syncDiscordTravelTracker(env, { force: true }));
}

export async function getDiscordTravelTrackerTargetFromRequest(env: Env): Promise<Response> {
  const [target, war] = await Promise.all([
    readTravelTrackerTarget(env),
    readCurrentScoutingWar(env),
  ]);
  const checkedAt = nowSeconds();
  const activeWar = war && isWarRoomMemberTrackingActive(war, checkedAt)
    ? {
        war_id: war.id,
        faction_id: war.enemy_faction_id,
        name: war.name,
      }
    : null;

  return json({
    ok: true,
    active_source: activeWar ? "war" : target ? "manual" : "inactive",
    war_target: activeWar,
    manual_target: serializeTravelTrackerTarget(target),
  });
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
  return json({
    ok: true,
    target: serializeTravelTrackerTarget(target),
  });
}

export async function clearDiscordTravelTrackerTargetFromRequest(env: Env): Promise<Response> {
  const result = await clearTravelTrackerTarget(env);
  return json({
    ok: true,
    cleared: d1Changes(result),
  });
}

export async function syncDiscordTravelTracker(
  env: Env,
  options: { force?: boolean; scheduledTime?: number } = {},
): Promise<DiscordTravelTrackerSyncResult> {
  const state = await readTravelTrackerState(env);
  if (!env.DISCORD_WEBHOOK_URL) {
    return trackerResult(true, "DISCORD_WEBHOOK_URL is not configured", null, null, "inactive", state?.message_id ?? null, 0, 0, false);
  }

  const checkedAt = options.scheduledTime ? Math.floor(options.scheduledTime / 1000) : nowSeconds();
  const target = await resolveTravelTrackerTarget(env, checkedAt);
  if (!target) {
    if (!state?.message_id) {
      return trackerResult(true, "no active travel tracker target", null, null, "inactive", null, 0, 0, false);
    }
    return updateTravelTrackerMessage(env, state, null, [], checkedAt, options.force ?? false);
  }

  const refreshed = target.source === "manual"
    ? await refreshManualTravelTrackerTarget(env, target)
    : undefined;
  const members = await readTravelTrackerRows(env, target.factionId);
  return updateTravelTrackerMessage(env, state, target, members, checkedAt, options.force ?? false, refreshed);
}

async function updateTravelTrackerMessage(
  env: Env,
  state: DiscordTravelTrackerState | null,
  target: TravelTrackerTarget | null,
  members: TravelTrackerRow[],
  checkedAt: number,
  force: boolean,
  refreshed?: unknown,
): Promise<DiscordTravelTrackerSyncResult> {
  const message = buildTravelTrackerMessage(target, members, checkedAt);
  const hash = contentHash(message.content);
  const { traveling, abroad } = travelCounts(members);
  const existingMessageId = state?.message_id ?? null;
  const warId = target?.warId ?? null;
  const factionId = target?.factionId ?? null;
  const source = target?.source ?? "inactive";

  if (!force && existingMessageId && state?.content_hash === hash && state.war_id === warId) {
    await markTravelTrackerChecked(env, state, checkedAt);
    return trackerResult(true, "travel tracker unchanged", warId, factionId, source, existingMessageId, traveling, abroad, false, refreshed);
  }

  const messageId = existingMessageId
    ? await editExistingTravelTrackerMessage(env, existingMessageId, message)
    : await createDiscordWebhookMessage(
      env,
      message.content,
      { users: [], roles: [] },
      { embedColor: message.color },
    );

  await saveTravelTrackerState(env, {
    warId,
    messageId: messageId ?? existingMessageId,
    contentHash: hash,
    checkedAt,
  });

  return trackerResult(false, undefined, warId, factionId, source, messageId ?? existingMessageId, traveling, abroad, true, refreshed);
}

async function editExistingTravelTrackerMessage(
  env: Env,
  messageId: string,
  message: { content: string; color: number },
): Promise<string> {
  await editDiscordWebhookMessage(
    env,
    messageId,
    message.content,
    { users: [], roles: [] },
    { embedColor: message.color },
  );
  return messageId;
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
        "Faction Travel Tracker: inactive",
        `No active war-room or manual faction travel tracking. Last checked <t:${checkedAt}:R>.`,
      ].join("\n"),
    };
  }

  const { traveling, abroad } = travelCounts(members);
  const title = target.source === "war"
    ? `Enemy Travel Tracker: War vs ${target.name}`
    : `Faction Travel Tracker: ${target.name}`;
  const lines = [
    title,
    `Updated <t:${checkedAt}:R> | ${traveling} traveling | ${abroad} abroad | ${target.factionId}`,
    "",
    ...formatTravelTrackerSections(members, { includeEmptySections: true }),
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "");

  return {
    color: TRAVEL_TRACKER_COLOR,
    content: fitDiscordMessage(lines.join("\n")),
  };
}

async function resolveTravelTrackerTarget(env: Env, checkedAt: number): Promise<TravelTrackerTarget | null> {
  const war = await readCurrentScoutingWar(env);
  if (war && isWarRoomMemberTrackingActive(war, checkedAt)) {
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

async function readTravelTrackerRows(env: Env, factionId: number): Promise<TravelTrackerRow[]> {
  const result = await env.DB.prepare(
    `
    SELECT
      member_id,
      name,
      status_state,
      status_description,
      plane_image_type,
      travel_origin,
      travel_destination,
      travel_started_after,
      travel_started_before,
      estimated_arrival_at,
      estimated_arrival_earliest,
      estimated_arrival_latest,
      travel_trip_destination,
      travel_trip_type,
      travel_trip_inferred_at
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND status_state IN ('Traveling', 'Abroad')
    ORDER BY
      CASE WHEN status_state = 'Traveling' THEN 0 ELSE 1 END,
      COALESCE(estimated_arrival_at, estimated_arrival_latest, 9223372036854775807),
      COALESCE(travel_trip_destination, travel_destination, status_description, ''),
      LOWER(name)
    LIMIT ?
    `,
  ).bind(factionId, TRAVEL_TRACKER_LIMIT).all<TravelTrackerRow>();

  return result.results ?? [];
}

async function readTravelTrackerState(env: Env): Promise<DiscordTravelTrackerState | null> {
  return await env.DB.prepare(
    `
    SELECT *
    FROM discord_travel_tracker_state
    WHERE id = ?
    LIMIT 1
    `,
  ).bind(TRAVEL_TRACKER_STATE_ID).first<DiscordTravelTrackerState>();
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
  state: DiscordTravelTrackerState,
  checkedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE discord_travel_tracker_state
    SET last_synced_at = ?,
        updated_at = unixepoch()
    WHERE id = ?
    `,
  ).bind(checkedAt, state.id).run();
}

async function saveTravelTrackerState(
  env: Env,
  input: {
    warId: number | null;
    messageId: string | null;
    contentHash: string;
    checkedAt: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO discord_travel_tracker_state (
      id,
      war_id,
      message_id,
      content_hash,
      last_synced_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      war_id = excluded.war_id,
      message_id = excluded.message_id,
      content_hash = excluded.content_hash,
      last_synced_at = excluded.last_synced_at,
      updated_at = unixepoch()
    `,
  ).bind(
    TRAVEL_TRACKER_STATE_ID,
    input.warId,
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

function trackerResult(
  skipped: boolean,
  reason: string | undefined,
  warId: number | null,
  factionId: number | null,
  source: "war" | "manual" | "inactive",
  messageId: string | null,
  traveling: number,
  abroad: number,
  changed: boolean,
  refreshed?: unknown,
): DiscordTravelTrackerSyncResult {
  return {
    ok: true,
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
  if (message.length <= 1900) {
    return message;
  }

  return `${message.slice(0, 1870).trimEnd()}\n...`;
}
