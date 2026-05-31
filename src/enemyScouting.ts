import {
  FFSCOUTER_STATS_API_URL,
  HOME_FACTION_ID,
  LOL_MANAGER_BATTLESTATS_API_BASE_URL,
  TORN_FACTION_API_BASE_URL,
} from "./constants";
import {
  canInitializeEnemyTarget,
  enemyTargetBspFillCompleteLatchName,
  enemyTargetComparisonStatsCompleteLatchName,
  enemyTargetFfFillCompleteLatchName,
  enemyTargetNetworthFillCompleteLatchName,
  handleEnemyTargetMatched,
} from "./enemyTargetLifecycle";
import {
  readEnemyHitStatHealth,
  readEnemyHitStatTrends,
  seedEnemyHitStatSnapshots,
} from "./enemyHitStats";
import { ENEMY_NETWORTH_MAX_ATTEMPTS } from "./enemyNetworth";
import {
  buildEnemyPushSnapshot,
  PUSH_ALERT_STATE_PREFIX,
  sendEnemyPushAlerts,
  upsertEnemyPushSnapshot,
} from "./enemyPushPressure";
import {
  clearSyncLatchesByPrefix,
  isSyncLatchSet,
} from "./syncLatches";
import { hasSyncState, upsertSyncTimestamp } from "./syncState";
import { trackedTornFetch } from "./tornApiUsage";
import { Env, TornFactionMember, TornFactionMembersResponse, WarRow } from "./types";
import {
  boolToInt,
  cleanText,
  d1Changes,
  fetchWithTimeout,
  finiteNumber,
  json,
  nowSeconds,
} from "./utils";
import {
  buildTravelDisplay,
  buildTravelSignature,
  estimateTravelArrival,
  initialTravelTripType,
  parseAbroadLocation,
  parseStoredTravelTripType,
  parseTravelDescription,
  resolveTravelTripType,
  TORN_LOCATION,
} from "./enemyTravel";
import { readWarFromScoutingUrl } from "./warRequest";

const FFSCOUTER_BATCH_SIZE = 100;
const SCOUTING_FETCH_TIMEOUT_MS = 15000;
const LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX = "enemy_live_tracking_cleared";

export type EnemyFactionMemberRow = {
  member_id: number;
  faction_id: number;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number | null;
  ff_battlestats: number | null;
  ff_battlestats_updated_at: number | null;
  bsp_battlestats: number | null;
  bsp_battlestats_updated_at: number | null;
  networth: number | null;
  networth_updated_at: number | null;
  networth_attempted_at: number | null;
  networth_attempt_count: number | null;
  networth_error: string | null;
  networth_key_source: string | null;
  status_state?: string | null;
  status_description?: string | null;
  last_action_status?: string | null;
  last_action_timestamp?: number | null;
  plane_image_type?: string | null;
  travel_origin?: string | null;
  travel_destination?: string | null;
  travel_signature?: string | null;
  travel_detected_at?: number | null;
  travel_started_after?: number | null;
  travel_started_before?: number | null;
  estimated_arrival_at?: number | null;
  estimated_arrival_earliest?: number | null;
  estimated_arrival_latest?: number | null;
  travel_trip_destination?: string | null;
  travel_trip_type?: string | null;
  travel_trip_inferred_at?: number | null;
  status_updated_at?: number | null;
  updated_at: number;
};

type FfBattlestatEstimate = {
  stats: number;
  updatedAt: number | null;
};

type MemberStatusSnapshot = {
  status_state: string | null;
  status_description: string | null;
  last_action_status: string | null;
  last_action_timestamp: number | null;
  plane_image_type: string | null;
  travel_origin: string | null;
  travel_destination: string | null;
  travel_signature: string | null;
  travel_detected_at: number | null;
  travel_started_after: number | null;
  travel_started_before: number | null;
  estimated_arrival_at: number | null;
  estimated_arrival_earliest: number | null;
  estimated_arrival_latest: number | null;
  travel_trip_destination: string | null;
  travel_trip_type: string | null;
  travel_trip_inferred_at: number | null;
  status_updated_at: number | null;
};

type EnemyMemberSnapshot = MemberStatusSnapshot & {
  member_id: number;
  faction_id: number;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number;
};

export type FfscouterRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  enemyCandidates: number;
  homeCandidates: number;
  enemyUpdated: number;
  homeUpdated: number;
  skipped: boolean;
};

export type BspBattlestatRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  candidates: number;
  updated: number;
  skipped: boolean;
};

export type ScoutingNetworthRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  candidates: number;
  updated: number;
  failed: number;
  rateLimited: number;
  activeKeys: number;
  skipped: boolean;
};

type EnemyScoutingWar = {
  id: number;
  enemy_faction_id: number | null;
  enemy_scouting_auto_attempted_at: number | null;
};

export type CurrentScoutingWar = {
  id: number;
  name: string;
  enemy_faction_id: number;
  war_type: string | null;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  enemy_scouting_status_checked_at: number | null;
};

export type EnemyMemberTrackingRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  fetchedMembers: number;
  updatedMembers: number;
  skipped: boolean;
  factionId?: number | null;
  members?: TornFactionMember[];
};

export async function getEnemyScoutingForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const scouting = await readEnemyScouting(env, enemyFactionId);
  return jsonEnemyScouting(war, scouting, false);
}

export async function getScoutingComparisonForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const [homeMembers, enemyMembers, comparisonStatsComplete, hitStatHealth, hitStatTrends] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, enemyFactionId),
    isEnemyTargetComparisonStatsCompleteForWar(env, war.id, enemyFactionId),
    readEnemyHitStatHealth(env, war.id, enemyFactionId),
    readEnemyHitStatTrends(env, war.id, enemyFactionId),
  ]);

  return json({
    ok: true,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_start_time: war.practical_start_time,
      practical_finish_time: war.practical_finish_time,
      official_start_time: war.official_start_time,
      official_end_time: war.official_end_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    home: {
      faction_id: HOME_FACTION_ID,
      members: homeMembers,
    },
    enemy: {
      faction_id: enemyFactionId,
      members: enemyMembers,
    },
    comparison_stats_complete: comparisonStatsComplete,
    hit_stats: {
      health: hitStatHealth,
      trends: hitStatTrends,
    },
  });
}

async function isEnemyTargetComparisonStatsCompleteForWar(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<boolean> {
  const comparisonStatsComplete = enemyTargetComparisonStatsCompleteLatchName(warId, enemyFactionId);
  const requiredStatsComplete = [
    enemyTargetFfFillCompleteLatchName(warId, enemyFactionId),
    enemyTargetBspFillCompleteLatchName(warId, enemyFactionId),
    enemyTargetNetworthFillCompleteLatchName(warId, enemyFactionId),
  ];
  const results = await Promise.all([
    isSyncLatchSet(env, comparisonStatsComplete),
    ...requiredStatsComplete.map((stateName) => isSyncLatchSet(env, stateName)),
  ]);

  return results[0] || results.slice(1).every(Boolean);
}

export async function refreshEnemyScoutingForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const existing = await readEnemyScouting(env, enemyFactionId);
  let refreshed = false;

  if (existing.length === 0) {
    refreshed = await replaceEnemyFactionMembers(env, war.id, enemyFactionId);
    if (refreshed) {
      await markEnemyScoutingStatusChecked(env, war.id, nowSeconds());
    }
  } else {
    await refreshEnemyFactionMemberStatuses(
      env,
      war.id,
      war.name,
      enemyFactionId,
      war.enemy_scouting_status_checked_at,
      { warType: war.war_type },
    );
    const refreshedRows = await readEnemyScouting(env, enemyFactionId);
    await refreshMissingFfBattlestats(env, refreshedRows);
    refreshed = true;
  }

  if (refreshed) {
    await refreshHomeFactionMembers(env);
  }

  const scouting = await readEnemyScouting(env, enemyFactionId);
  return jsonEnemyScouting(war, scouting, refreshed);
}

export async function fetchEnemyScoutingOnceForWar(env: Env, warId: number): Promise<void> {
  const war = (await env.DB.prepare(
    `
    SELECT id, enemy_faction_id, enemy_scouting_auto_attempted_at
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as EnemyScoutingWar | null;

  if (!war || war.enemy_faction_id === null || war.enemy_scouting_auto_attempted_at !== null) {
    return;
  }

  let refreshed = false;
  try {
    const enemyRefreshed = await replaceEnemyFactionMembers(env, war.id, war.enemy_faction_id);
    await refreshHomeFactionMembers(env);
    refreshed = enemyRefreshed;
  } catch (err: any) {
    console.warn(`Enemy scouting fetch failed for war ${warId}:`, err?.message || err);
  } finally {
    if (refreshed) {
      await env.DB.prepare(
        `
        UPDATE wars
        SET enemy_scouting_auto_attempted_at = COALESCE(enemy_scouting_auto_attempted_at, unixepoch()),
            enemy_scouting_status_checked_at = COALESCE(enemy_scouting_status_checked_at, unixepoch())
        WHERE id = ?
        `,
      )
        .bind(warId)
        .run();
    }
  }
}

export async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      enemy_faction_id,
      war_type,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      enemy_scouting_status_checked_at
    FROM wars
    WHERE enemy_faction_id IS NOT NULL
      AND official_end_time IS NULL
      AND COALESCE(war_type, 'real') != 'event'
    ORDER BY practical_start_time DESC, id DESC
    LIMIT 1
    `,
  ).first()) as CurrentScoutingWar | null;
}

export async function readEnemyScouting(
  env: Env,
  factionId: number,
): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
    ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
    `,
  )
    .bind(factionId)
    .all();

  return (rows.results ?? []) as EnemyFactionMemberRow[];
}

export async function readHomeScouting(env: Env): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE faction_id = ?
      AND is_current = 1
    ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
    `,
  )
    .bind(HOME_FACTION_ID)
    .all();

  return (rows.results ?? []) as EnemyFactionMemberRow[];
}

async function replaceEnemyFactionMembers(env: Env, warId: number, factionId: number): Promise<boolean> {
  if (!(await canInitializeEnemyTarget(env, factionId))) {
    console.warn(
      `Skipping enemy scouting refresh for faction ${factionId}: cached faction has not officially ended`,
    );
    return false;
  }

  const members = await fetchTornFactionMembers(env, factionId);

  if (members.length === 0) {
    return false;
  }

  const fetchedAt = nowSeconds();
  await handleEnemyTargetMatched(env, factionId, {
    warId,
    clearCachedEnemyRoster: true,
    clearHomeComparisonStats: true,
    clearReplaceableHeatmaps: true,
  });
  await env.DB.batch(
    members.map((member) => {
      const statusSnapshot = buildMemberStatusSnapshot(member, null, null, fetchedAt);
      return env.DB.prepare(
        `
        INSERT INTO enemy_faction_members (
          member_id,
          faction_id,
          name,
          level,
          position,
          days_in_faction,
          is_revivable,
          status_state,
          status_description,
          last_action_status,
          last_action_timestamp,
          plane_image_type,
          travel_origin,
          travel_destination,
          travel_signature,
          travel_detected_at,
          travel_started_after,
          travel_started_before,
          estimated_arrival_at,
          estimated_arrival_earliest,
          estimated_arrival_latest,
          travel_trip_destination,
          travel_trip_type,
          travel_trip_inferred_at,
          status_updated_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          status_state = excluded.status_state,
          status_description = excluded.status_description,
          last_action_status = excluded.last_action_status,
          last_action_timestamp = excluded.last_action_timestamp,
          plane_image_type = excluded.plane_image_type,
          travel_origin = excluded.travel_origin,
          travel_destination = excluded.travel_destination,
          travel_signature = excluded.travel_signature,
          travel_detected_at = excluded.travel_detected_at,
          travel_started_after = excluded.travel_started_after,
          travel_started_before = excluded.travel_started_before,
          estimated_arrival_at = excluded.estimated_arrival_at,
          estimated_arrival_earliest = excluded.estimated_arrival_earliest,
          estimated_arrival_latest = excluded.estimated_arrival_latest,
          travel_trip_destination = excluded.travel_trip_destination,
          travel_trip_type = excluded.travel_trip_type,
          travel_trip_inferred_at = excluded.travel_trip_inferred_at,
          status_updated_at = excluded.status_updated_at,
          updated_at = excluded.updated_at
        `,
      ).bind(
        member.id,
        factionId,
        member.name,
        finiteNumber(member.level),
        member.position ?? null,
        finiteNumber(member.days_in_faction),
        boolToInt(member.is_revivable ?? false),
        statusSnapshot.status_state,
        statusSnapshot.status_description,
        statusSnapshot.last_action_status,
        statusSnapshot.last_action_timestamp,
        statusSnapshot.plane_image_type,
        statusSnapshot.travel_origin,
        statusSnapshot.travel_destination,
        statusSnapshot.travel_signature,
        statusSnapshot.travel_detected_at,
        statusSnapshot.travel_started_after,
        statusSnapshot.travel_started_before,
        statusSnapshot.estimated_arrival_at,
        statusSnapshot.estimated_arrival_earliest,
        statusSnapshot.estimated_arrival_latest,
        statusSnapshot.travel_trip_destination,
        statusSnapshot.travel_trip_type,
        statusSnapshot.travel_trip_inferred_at,
        statusSnapshot.status_updated_at,
      );
    }),
  );

  const rows = await readEnemyScouting(env, factionId);
  await seedEnemyHitStatSnapshots(env, warId, factionId, rows, fetchedAt);
  await refreshMissingFfBattlestats(env, rows);
  return true;
}

async function refreshHomeFactionMembers(env: Env): Promise<void> {
  const members = await fetchTornFactionMembers(env, HOME_FACTION_ID);

  if (members.length === 0) {
    return;
  }

  await env.DB.batch(
    members.map((member) =>
      env.DB.prepare(
        `
        INSERT INTO home_faction_members (
          member_id,
          faction_id,
          name,
          level,
          position,
          days_in_faction,
          is_revivable,
          is_current,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          is_current = 1,
          updated_at = excluded.updated_at
        `,
      ).bind(
        member.id,
        HOME_FACTION_ID,
        member.name,
        finiteNumber(member.level),
        member.position ?? null,
        finiteNumber(member.days_in_faction),
        boolToInt(member.is_revivable ?? false),
      ),
    ),
  );

  await markDepartedHomeFactionMembers(env, members);

  const rows = (await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE ff_battlestats IS NULL
      AND is_current = 1
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  await refreshMissingFfBattlestats(env, rows ?? [], "home_faction_members");
}

async function markDepartedHomeFactionMembers(env: Env, members: TornFactionMember[]): Promise<void> {
  const ids = members.map((member) => member.id).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE home_faction_members
    SET is_current = 0,
        updated_at = unixepoch()
    WHERE member_id NOT IN (${ids.map(() => "?").join(",")})
      AND is_current != 0
    `,
  )
    .bind(...ids)
    .run();
}

export async function refreshEnemyFactionMemberStatuses(
  env: Env,
  warId: number,
  warName: string,
  factionId: number,
  previousPollAt: number | null,
  options: { members?: TornFactionMember[]; includeMembers?: boolean; warType?: string | null } = {},
): Promise<EnemyMemberTrackingRefreshMetrics> {
  const fetchedAt = nowSeconds();
  const members = options.members ?? await fetchTornFactionMembers(env, factionId);

  if (members.length === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId,
      members: options.includeMembers ? members : undefined,
    };
  }

  const existingRows = await readEnemyScouting(env, factionId);
  const existingById = new Map(existingRows.map((row) => [row.member_id, row]));
  const statements: D1PreparedStatement[] = [];
  const pushSnapshot = await buildEnemyPushSnapshot(env, warId, factionId, members, existingById, fetchedAt);

  for (const member of members) {
    const existing = existingById.get(member.id) ?? null;
    const next = buildEnemyMemberSnapshot(member, factionId, existing, previousPollAt, fetchedAt);
    if (!existing || enemyMemberSnapshotChanged(existing, next)) {
      statements.push(upsertEnemyMemberSnapshot(env, next));
    }
  }
  statements.push(upsertEnemyPushSnapshot(env, pushSnapshot));

  let changedRows = 0;
  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    changedRows = results.reduce((total: number, result: unknown) => total + d1Changes(result), 0);
  }

  await markEnemyScoutingStatusChecked(env, warId, fetchedAt);
  await sendEnemyPushAlerts(env, warId, warName, pushSnapshot, members, { warType: options.warType }).catch((err) => {
    console.warn(`Enemy push Discord alert failed for war ${warId}:`, err?.message || err);
  });

  return {
    writeStatements: statements.length + 1,
    changedRows,
    fetchedMembers: members.length,
    updatedMembers: statements.length,
    skipped: false,
    factionId,
    members: options.includeMembers ? members : undefined,
  };
}

function upsertEnemyMemberSnapshot(
  env: Env,
  snapshot: EnemyMemberSnapshot,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO enemy_faction_members (
      member_id,
      faction_id,
      name,
      level,
      position,
      days_in_faction,
      is_revivable,
      status_state,
      status_description,
      last_action_status,
      last_action_timestamp,
      plane_image_type,
      travel_origin,
      travel_destination,
      travel_signature,
      travel_detected_at,
      travel_started_after,
      travel_started_before,
      estimated_arrival_at,
      estimated_arrival_earliest,
      estimated_arrival_latest,
      travel_trip_destination,
      travel_trip_type,
      travel_trip_inferred_at,
      status_updated_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      name = excluded.name,
      level = excluded.level,
      position = excluded.position,
      days_in_faction = excluded.days_in_faction,
      is_revivable = excluded.is_revivable,
      status_state = excluded.status_state,
      status_description = excluded.status_description,
      last_action_status = excluded.last_action_status,
      last_action_timestamp = excluded.last_action_timestamp,
      plane_image_type = excluded.plane_image_type,
      travel_origin = excluded.travel_origin,
      travel_destination = excluded.travel_destination,
      travel_signature = excluded.travel_signature,
      travel_detected_at = excluded.travel_detected_at,
      travel_started_after = excluded.travel_started_after,
      travel_started_before = excluded.travel_started_before,
      estimated_arrival_at = excluded.estimated_arrival_at,
      estimated_arrival_earliest = excluded.estimated_arrival_earliest,
      estimated_arrival_latest = excluded.estimated_arrival_latest,
      travel_trip_destination = excluded.travel_trip_destination,
      travel_trip_type = excluded.travel_trip_type,
      travel_trip_inferred_at = excluded.travel_trip_inferred_at,
      status_updated_at = excluded.status_updated_at,
      updated_at = excluded.updated_at
    `,
  ).bind(
    snapshot.member_id,
    snapshot.faction_id,
    snapshot.name,
    snapshot.level,
    snapshot.position,
    snapshot.days_in_faction,
    snapshot.is_revivable,
    snapshot.status_state,
    snapshot.status_description,
    snapshot.last_action_status,
    snapshot.last_action_timestamp,
    snapshot.plane_image_type,
    snapshot.travel_origin,
    snapshot.travel_destination,
    snapshot.travel_signature,
    snapshot.travel_detected_at,
    snapshot.travel_started_after,
    snapshot.travel_started_before,
    snapshot.estimated_arrival_at,
    snapshot.estimated_arrival_earliest,
    snapshot.estimated_arrival_latest,
    snapshot.travel_trip_destination,
    snapshot.travel_trip_type,
    snapshot.travel_trip_inferred_at,
    snapshot.status_updated_at,
  );
}

export async function clearLiveEnemyTrackingData(
  env: Env,
  warId: number,
  factionId: number,
): Promise<{ writeStatements: number; changedRows: number }> {
  const stateName = liveEnemyTrackingClearLatchName(warId);
  if (await hasSyncState(env, stateName)) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const cleared = await clearLiveEnemyTrackingRows(env, warId, factionId);
  await upsertSyncTimestamp(env, stateName, nowSeconds(), warId);

  return {
    writeStatements: cleared.writeStatements + 1,
    changedRows: cleared.changedRows + 1,
  };
}

export async function restartLiveEnemyTrackingFromRequest(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { war_id?: unknown };
  const warId = Number(body.war_id);
  if (!Number.isInteger(warId) || warId <= 0) {
    return json({ ok: false, error: "A valid war_id is required", code: "INVALID_WAR_ID" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT id, name, enemy_faction_id
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { id: number; name: string; enemy_faction_id: number | null } | null;

  if (!war) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }

  if (war.enemy_faction_id === null) {
    return json(
      { ok: false, error: "Selected war has no enemy faction to restart", code: "NO_ENEMY_FACTION" },
      400,
    );
  }

  const result = await clearLiveEnemyTrackingRows(env, war.id, war.enemy_faction_id, {
    resetWarCheckedAt: true,
  });

  return json({
    ok: true,
    war_id: war.id,
    war_name: war.name,
    enemy_faction_id: war.enemy_faction_id,
    ...result,
  });
}

async function clearLiveEnemyTrackingRows(
  env: Env,
  warId: number,
  factionId: number,
  options: { resetWarCheckedAt?: boolean } = {},
): Promise<{ writeStatements: number; changedRows: number }> {
  const memberResult = await env.DB.prepare(
    `
    UPDATE enemy_faction_members
    SET is_revivable = NULL,
        status_state = NULL,
        status_description = NULL,
        last_action_status = NULL,
        last_action_timestamp = NULL,
        plane_image_type = NULL,
        travel_origin = NULL,
        travel_destination = NULL,
        travel_signature = NULL,
        travel_detected_at = NULL,
        travel_started_after = NULL,
        travel_started_before = NULL,
        estimated_arrival_at = NULL,
        estimated_arrival_earliest = NULL,
        estimated_arrival_latest = NULL,
        travel_trip_destination = NULL,
        travel_trip_type = NULL,
        travel_trip_inferred_at = NULL,
        status_updated_at = NULL,
        updated_at = unixepoch()
    WHERE faction_id = ?
      AND (
        is_revivable IS NOT NULL OR
        status_state IS NOT NULL OR
        status_description IS NOT NULL OR
        last_action_status IS NOT NULL OR
        last_action_timestamp IS NOT NULL OR
        plane_image_type IS NOT NULL OR
        travel_origin IS NOT NULL OR
        travel_destination IS NOT NULL OR
        travel_signature IS NOT NULL OR
        travel_detected_at IS NOT NULL OR
        travel_started_after IS NOT NULL OR
        travel_started_before IS NOT NULL OR
        estimated_arrival_at IS NOT NULL OR
        estimated_arrival_earliest IS NOT NULL OR
        estimated_arrival_latest IS NOT NULL OR
        travel_trip_destination IS NOT NULL OR
        travel_trip_type IS NOT NULL OR
        travel_trip_inferred_at IS NOT NULL OR
        status_updated_at IS NOT NULL
      )
    `,
  )
    .bind(factionId)
    .run();

  const pushSnapshotResult = await env.DB.prepare(
    `
    DELETE FROM enemy_push_activity_snapshots
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .run();

  const pushAlertResult = await clearSyncLatchesByPrefix(
    env,
    `${PUSH_ALERT_STATE_PREFIX}:${warId}:`,
  );

  const warCheckedResult = options.resetWarCheckedAt
    ? await env.DB.prepare(
        `
        UPDATE wars
        SET enemy_scouting_status_checked_at = NULL
        WHERE id = ?
        `,
      )
        .bind(warId)
        .run()
    : null;

  return {
    writeStatements: options.resetWarCheckedAt ? 4 : 3,
    changedRows:
      d1Changes(memberResult) +
      d1Changes(pushSnapshotResult) +
      d1Changes(pushAlertResult) +
      d1Changes(warCheckedResult),
  };
}

function liveEnemyTrackingClearLatchName(warId: number): string {
  return `${LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX}:${warId}`;
}

async function markEnemyScoutingStatusChecked(
  env: Env,
  warId: number,
  checkedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE wars
    SET enemy_scouting_status_checked_at = ?
    WHERE id = ?
    `,
  )
    .bind(checkedAt, warId)
    .run();
}

function buildEnemyMemberSnapshot(
  member: TornFactionMember,
  factionId: number,
  previous: EnemyFactionMemberRow | null,
  previousPollAt: number | null,
  fetchedAt: number,
): EnemyMemberSnapshot {
  return {
    member_id: member.id,
    faction_id: factionId,
    name: member.name,
    level: finiteNumber(member.level),
    position: member.position ?? null,
    days_in_faction: finiteNumber(member.days_in_faction),
    is_revivable: boolToInt(member.is_revivable ?? false) ?? 0,
    ...buildMemberStatusSnapshot(member, previous, previousPollAt, fetchedAt),
  };
}

function buildMemberStatusSnapshot(
  member: TornFactionMember,
  previous: EnemyFactionMemberRow | null,
  previousPollAt: number | null,
  fetchedAt: number,
): MemberStatusSnapshot {
  const statusState = cleanText(member.status?.state);
  const statusDescription = cleanText(member.status?.description);
  const lastActionStatus = cleanText(member.last_action?.status);
  const lastActionTimestamp = finiteNumber(member.last_action?.timestamp);
  const planeImageType = cleanText(member.status?.plane_image_type);
  const parsedTravel = parseTravelDescription(statusDescription);
  const isTraveling = statusState === "Traveling" && parsedTravel !== null;
  const abroadLocation = statusState === "Abroad" ? parseAbroadLocation(statusDescription) : null;
  const travelSignature = isTraveling
    ? buildTravelSignature(statusDescription, planeImageType, parsedTravel)
    : null;
  const statusChanged =
    previous === null ||
    previous.status_state !== statusState ||
    previous.status_description !== statusDescription ||
    previous.plane_image_type !== planeImageType ||
    previous.travel_signature !== travelSignature;
  const isNewTrip =
    isTraveling &&
    (previous?.status_state !== "Traveling" || previous.travel_signature !== travelSignature);

  if (!isTraveling || !parsedTravel) {
    const keepTrip =
      statusState === "Abroad" &&
      abroadLocation !== null &&
      previous?.travel_trip_destination === abroadLocation;

    return {
      status_state: statusState,
      status_description: statusDescription,
      last_action_status: lastActionStatus,
      last_action_timestamp: lastActionTimestamp,
      plane_image_type: planeImageType,
      travel_origin: null,
      travel_destination: null,
      travel_signature: null,
      travel_detected_at: null,
      travel_started_after: null,
      travel_started_before: null,
      estimated_arrival_at: null,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: null,
      travel_trip_destination: keepTrip ? (previous?.travel_trip_destination ?? null) : null,
      travel_trip_type: keepTrip ? (previous?.travel_trip_type ?? null) : null,
      travel_trip_inferred_at: keepTrip ? (previous?.travel_trip_inferred_at ?? null) : null,
      status_updated_at: statusChanged ? fetchedAt : (previous?.status_updated_at ?? fetchedAt),
    };
  }

  const previousTrip =
    previous && previous.travel_trip_destination === parsedTravel.flightLocation
      ? {
          type: parseStoredTravelTripType(previous.travel_trip_type),
          inferredAt: previous.travel_trip_inferred_at ?? null,
        }
      : null;
  const baseTripType =
    parsedTravel.destination === TORN_LOCATION && previousTrip?.type
      ? previousTrip.type
      : initialTravelTripType(planeImageType);

  if (!isNewTrip && previous) {
    const tripType = resolveTravelTripType(
      parsedTravel.flightLocation,
      planeImageType,
      previous.travel_started_before ?? fetchedAt,
      baseTripType,
      previousTrip?.inferredAt ?? previous.travel_trip_inferred_at ?? null,
      fetchedAt,
    );
    const estimate =
      planeImageType === "airliner"
        ? estimateTravelArrival(
            parsedTravel.flightLocation,
            planeImageType,
            previous.travel_started_after ?? null,
            previous.travel_started_before ?? fetchedAt,
            tripType.type,
          )
        : {
            estimated_arrival_at: previous.estimated_arrival_at ?? null,
            estimated_arrival_earliest: previous.estimated_arrival_earliest ?? null,
            estimated_arrival_latest: previous.estimated_arrival_latest ?? null,
          };

    return {
      status_state: statusState,
      status_description: statusDescription,
      last_action_status: lastActionStatus,
      last_action_timestamp: lastActionTimestamp,
      plane_image_type: planeImageType,
      travel_origin: parsedTravel.origin,
      travel_destination: parsedTravel.destination,
      travel_signature: travelSignature,
      travel_detected_at: previous.travel_detected_at ?? null,
      travel_started_after: previous.travel_started_after ?? null,
      travel_started_before: previous.travel_started_before ?? null,
      ...estimate,
      travel_trip_destination: parsedTravel.flightLocation,
      travel_trip_type: tripType.type,
      travel_trip_inferred_at: tripType.inferredAt,
      status_updated_at: statusChanged ? fetchedAt : (previous.status_updated_at ?? fetchedAt),
    };
  }

  const startedAfter = previous
    ? previousPollAt ?? previous.status_updated_at ?? null
    : null;
  const startedBefore = fetchedAt;
  const tripType = resolveTravelTripType(
    parsedTravel.flightLocation,
    planeImageType,
    startedBefore,
    baseTripType,
    previousTrip?.inferredAt ?? null,
    fetchedAt,
  );
  const estimate = estimateTravelArrival(
    parsedTravel.flightLocation,
    planeImageType,
    startedAfter,
    startedBefore,
    tripType.type,
  );

  return {
    status_state: statusState,
    status_description: statusDescription,
    last_action_status: lastActionStatus,
    last_action_timestamp: lastActionTimestamp,
    plane_image_type: planeImageType,
    travel_origin: parsedTravel.origin,
    travel_destination: parsedTravel.destination,
    travel_signature: travelSignature,
    travel_detected_at: fetchedAt,
    travel_started_after: startedAfter,
    travel_started_before: startedBefore,
    ...estimate,
    travel_trip_destination: parsedTravel.flightLocation,
    travel_trip_type: tripType.type,
    travel_trip_inferred_at: tripType.inferredAt,
    status_updated_at: fetchedAt,
  };
}

function enemyMemberSnapshotChanged(
  previous: EnemyFactionMemberRow,
  next: EnemyMemberSnapshot,
): boolean {
  return (
    previous.faction_id !== next.faction_id ||
    previous.name !== next.name ||
    previous.level !== next.level ||
    previous.position !== next.position ||
    previous.days_in_faction !== next.days_in_faction ||
    previous.is_revivable !== next.is_revivable ||
    previous.status_state !== next.status_state ||
    previous.status_description !== next.status_description ||
    previous.last_action_status !== next.last_action_status ||
    previous.last_action_timestamp !== next.last_action_timestamp ||
    previous.plane_image_type !== next.plane_image_type ||
    previous.travel_origin !== next.travel_origin ||
    previous.travel_destination !== next.travel_destination ||
    previous.travel_signature !== next.travel_signature ||
    previous.travel_detected_at !== next.travel_detected_at ||
    previous.travel_started_after !== next.travel_started_after ||
    previous.travel_started_before !== next.travel_started_before ||
    previous.estimated_arrival_at !== next.estimated_arrival_at ||
    previous.estimated_arrival_earliest !== next.estimated_arrival_earliest ||
    previous.estimated_arrival_latest !== next.estimated_arrival_latest ||
    previous.travel_trip_destination !== next.travel_trip_destination ||
    previous.travel_trip_type !== next.travel_trip_type ||
    previous.travel_trip_inferred_at !== next.travel_trip_inferred_at ||
    previous.status_updated_at !== next.status_updated_at
  );
}

export async function refreshMissingFfBattlestats(
  env: Env,
  rows: EnemyFactionMemberRow[],
  tableName = "enemy_faction_members",
): Promise<{ writeStatements: number; changedRows: number }> {
  const metrics = { writeStatements: 0, changedRows: 0 };
  if (!env.FFSCOUTER_API_KEY) {
    return metrics;
  }

  const missingIds = rows
    .filter((row) => row.ff_battlestats === null)
    .map((row) => row.member_id);

  for (const ids of chunks(missingIds, FFSCOUTER_BATCH_SIZE)) {
    const estimates = await fetchFfscouterStats(env, ids).catch((err) => {
      console.warn("FFScouter stats fetch failed:", err?.message || err);
      return new Map<number, FfBattlestatEstimate>();
    });

    const statements = Array.from(estimates.entries()).map(([memberId, estimate]) =>
      env.DB.prepare(
        `
        UPDATE ${tableName}
        SET ff_battlestats = ?,
            ff_battlestats_updated_at = COALESCE(?, unixepoch()),
            updated_at = unixepoch()
        WHERE member_id = ?
        `,
      ).bind(estimate.stats, estimate.updatedAt, memberId),
    );

    if (statements.length > 0) {
      const results = await env.DB.batch(statements);
      metrics.writeStatements += statements.length;
      metrics.changedRows += results.reduce(
        (total: number, result: unknown) => total + d1Changes(result),
        0,
      );
    }
  }

  return metrics;
}

export async function fetchTornFactionMembers(
  env: Env,
  factionId: number,
): Promise<TornFactionMember[]> {
  const url = new URL(`${TORN_FACTION_API_BASE_URL}/${factionId}/members`);
  url.searchParams.set("striptags", "false");

  const response = await trackedTornFetch(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "enemy-scouting:faction-members",
    keySource: "env:TORN_API_KEY",
    timeoutMs: SCOUTING_FETCH_TIMEOUT_MS,
  });

  if (!response.ok) {
    throw new Error(`Torn faction members API error: ${response.status}`);
  }

  const data = (await response.json()) as TornFactionMembersResponse;
  return normalizeMembers(data.members);
}

async function fetchFfscouterStats(
  env: Env,
  memberIds: number[],
): Promise<Map<number, FfBattlestatEstimate>> {
  if (memberIds.length === 0 || !env.FFSCOUTER_API_KEY) {
    return new Map();
  }

  const url = new URL(FFSCOUTER_STATS_API_URL);
  url.searchParams.set("key", env.FFSCOUTER_API_KEY);
  url.searchParams.set("targets", memberIds.join(","));

  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/json" },
  }, SCOUTING_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`FFScouter API error: ${response.status}`);
  }

  return extractFfBattlestatEstimates(await response.json());
}

export async function fetchBspBattlestatPrediction(
  env: Env,
  memberId: number,
): Promise<number | null> {
  if (!env.BSP_TORN_API_KEY) {
    throw new Error("BSP_TORN_API_KEY is not configured");
  }

  const url = `${LOL_MANAGER_BATTLESTATS_API_BASE_URL}/${encodeURIComponent(env.BSP_TORN_API_KEY)}/${memberId}/9.4.2`;
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  }, SCOUTING_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`BSP battlestats API error: ${response.status}`);
  }

  return parseBspBattlestatPrediction(await response.json());
}

function parseBspBattlestatPrediction(data: any): number | null {
  const prediction = parseBspBattlestatPayload(data);
  const result = Number.isFinite(Number(prediction?.Result)) ? Number(prediction.Result) : null;
  if (result === 0 || result === 4) {
    return null;
  }

  return finiteNumber(prediction?.TBS);
}

function parseBspBattlestatPayload(data: any): any {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function extractFfBattlestatEstimates(data: any): Map<number, FfBattlestatEstimate> {
  const estimates = new Map<number, FfBattlestatEstimate>();
  const containers = [data?.stats, data?.data, data?.results, data];

  for (const container of containers) {
    if (!container) continue;

    if (Array.isArray(container)) {
      for (const item of container) {
        addEstimate(estimates, item?.id ?? item?.player_id ?? item?.target, item);
      }
      continue;
    }

    if (typeof container === "object") {
      for (const [key, value] of Object.entries(container)) {
        addEstimate(estimates, key, value);
      }
    }
  }

  return estimates;
}

function addEstimate(estimates: Map<number, FfBattlestatEstimate>, idValue: unknown, source: any) {
  const memberId = Number(idValue);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return;
  }

  const stats =
    source && typeof source === "object"
      ? firstFiniteNumber(
          source.total,
          source.total_stats,
          source.bs_estimate,
          source.ff_battlestats,
          source.battle_stats,
          source.stats,
          source.value,
        )
      : finiteNumber(source);

  if (stats !== null) {
    estimates.set(memberId, {
      stats,
      updatedAt: firstFiniteNumber(source?.last_updated, source?.updated_at),
    });
  }
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function normalizeMembers(
  members: TornFactionMembersResponse["members"],
): TornFactionMember[] {
  if (!members) {
    return [];
  }

  return Array.isArray(members) ? members : Object.values(members);
}

function jsonEnemyScouting(
  war: WarRow,
  rows: EnemyFactionMemberRow[],
  refreshed: boolean,
): Response {
  const statsRows = rows.filter((row) => row.ff_battlestats !== null);
  const networthRows = rows.filter((row) => row.networth !== null);
  const networthPendingRows = rows.filter((row) => row.networth_updated_at === null);
  const networthFailedRows = networthPendingRows.filter(
    (row) => Number(row.networth_attempt_count ?? 0) >= ENEMY_NETWORTH_MAX_ATTEMPTS,
  );
  const networthRetryableRows = networthPendingRows.filter(
    (row) => Number(row.networth_attempt_count ?? 0) < ENEMY_NETWORTH_MAX_ATTEMPTS,
  );
  const travelingRows = rows.filter((row) => row.status_state === "Traveling");
  const averageLevel =
    rows.length === 0
      ? 0
      : rows.reduce((total, row) => total + Number(row.level ?? 0), 0) / rows.length;
  const averageFfBattlestats =
    statsRows.length === 0
      ? null
      : statsRows.reduce((total, row) => total + Number(row.ff_battlestats ?? 0), 0) /
        statsRows.length;

  return json({
    ok: true,
    refreshed,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    summary: {
      members_loaded: rows.length,
      average_level: averageLevel,
      average_ff_battlestats: averageFfBattlestats,
      missing_ff_battlestats: rows.length - statsRows.length,
      stats_available: statsRows.length,
      networth_available: networthRows.length,
      networth_pending: networthPendingRows.length,
      networth_failed: networthFailedRows.length,
      networth_retryable: networthRetryableRows.length,
      traveling: travelingRows.length,
      status_checked_at: war.enemy_scouting_status_checked_at,
    },
    members: rows.map((row) => ({
      ...row,
      ...buildTravelDisplay(row),
    })),
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
