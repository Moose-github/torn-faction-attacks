import {
  FFSCOUTER_STATS_API_URL,
  HOME_FACTION_ID,
  LOL_MANAGER_BATTLESTATS_API_BASE_URL,
  TORN_FACTION_API_BASE_URL,
} from "./constants";
import { sendDiscordMessage, sendDiscordMessageWithAttachment } from "./discord";
import {
  canInitializeEnemyTarget,
  enemyTargetBspFillCompleteLatchName,
  enemyTargetFfFillCompleteLatchName,
  enemyTargetNetworthFillCompleteLatchName,
  enemyTargetStatsImagePendingLatchName,
  enemyTargetStatsImageSentLatchName,
  handleEnemyTargetMatched,
} from "./enemyTargetLifecycle";
import { fetchTornPersonalStats } from "./personalStats";
import {
  clearSyncLatch,
  clearSyncLatchesByPrefix,
  isSyncLatchSet,
  setSyncLatch,
} from "./syncLatches";
import { hasSyncState, upsertSyncTimestamp } from "./syncState";
import { Env, TornFactionMember, TornFactionMembersResponse, WarRow } from "./types";
import { boolToInt, json, nowSeconds } from "./utils";
import { isWarRoomMemberTrackingActive, isWarRoomMemberTrackingLive } from "./warRoomTracking";

const FFSCOUTER_BATCH_SIZE = 100;
const SCOUTING_FETCH_TIMEOUT_MS = 15000;
const BSP_BATTLESTAT_REFRESH_LIMIT = 40;
const NETWORTH_REFRESH_LIMIT = 40;
const TORN_LOCATION = "Torn";
const HOME_STATS_LABEL = "Buttgrass";
const LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX = "enemy_live_tracking_cleared";
const BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS = 5 * 60;
const PUSH_RECENT_ACTIVITY_WINDOW_SECONDS = 5 * 60;
const PUSH_REFERENCE_WINDOW_SECONDS = 10 * 60;
const PUSH_HISTORY_SECONDS = 24 * 60 * 60;
const HEATMAP_INTERVAL_MINUTES = 15;
const PUSH_ALERT_USER_MENTION = "<@327916221330620436>";
const PUSH_ALERT_STATE_PREFIX = "enemy_push_alert";

type TravelDurationKey = "Standard" | "Airstrip" | "WLT benefit" | "Business Class";
type StoredTravelTripType = TravelDurationKey | "Business Class/Standard";
type ScoutingComparisonMetric = "ff_battlestats" | "bsp_battlestats" | "networth";
type ScoutingBucket = { label: string; min: number; max: number };

const TRAVEL_DURATIONS_MINUTES: Record<string, Record<TravelDurationKey, number>> = {
  Mexico: { Standard: 26, Airstrip: 18, "WLT benefit": 13, "Business Class": 8 },
  "Cayman Islands": { Standard: 35, Airstrip: 25, "WLT benefit": 18, "Business Class": 11 },
  Canada: { Standard: 41, Airstrip: 29, "WLT benefit": 20, "Business Class": 12 },
  Hawaii: { Standard: 134, Airstrip: 94, "WLT benefit": 67, "Business Class": 40 },
  "United Kingdom": { Standard: 159, Airstrip: 111, "WLT benefit": 80, "Business Class": 48 },
  Argentina: { Standard: 167, Airstrip: 117, "WLT benefit": 83, "Business Class": 50 },
  Switzerland: { Standard: 175, Airstrip: 123, "WLT benefit": 88, "Business Class": 53 },
  Japan: { Standard: 225, Airstrip: 158, "WLT benefit": 113, "Business Class": 68 },
  China: { Standard: 242, Airstrip: 169, "WLT benefit": 121, "Business Class": 72 },
  "United Arab Emirates": { Standard: 271, Airstrip: 190, "WLT benefit": 135, "Business Class": 81 },
  "South Africa": { Standard: 297, Airstrip: 208, "WLT benefit": 149, "Business Class": 89 },
};

const BATTLE_STATS_BUCKETS: ScoutingBucket[] = [
  { label: "<1m", min: 0, max: 1_000_000 },
  { label: "1m-10m", min: 1_000_000, max: 10_000_000 },
  { label: "10m-100m", min: 10_000_000, max: 100_000_000 },
  { label: "100m-250m", min: 100_000_000, max: 250_000_000 },
  { label: "250m-500m", min: 250_000_000, max: 500_000_000 },
  { label: "500m-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b+", min: 10_000_000_000, max: Number.POSITIVE_INFINITY },
];

const NETWORTH_BUCKETS: ScoutingBucket[] = [
  { label: "<500m", min: 0, max: 500_000_000 },
  { label: "0.5b-1b", min: 500_000_000, max: 1_000_000_000 },
  { label: "1b-2.5b", min: 1_000_000_000, max: 2_500_000_000 },
  { label: "2.5b-5b", min: 2_500_000_000, max: 5_000_000_000 },
  { label: "5b-10b", min: 5_000_000_000, max: 10_000_000_000 },
  { label: "10b-20b", min: 10_000_000_000, max: 20_000_000_000 },
  { label: "20b-30b", min: 20_000_000_000, max: 30_000_000_000 },
  { label: "30b-40b", min: 30_000_000_000, max: 40_000_000_000 },
  { label: "40b-50b", min: 40_000_000_000, max: 50_000_000_000 },
  { label: "50b+", min: 50_000_000_000, max: Number.POSITIVE_INFINITY },
];

const PLANE_IMAGE_TYPE_TO_DURATION_KEY: Record<string, TravelDurationKey> = {
  light_aircraft: "Airstrip",
  private_jet: "WLT benefit",
};

const PLANE_IMAGE_TYPE_LABELS: Record<string, string> = {
  airliner: "Airliner",
  light_aircraft: "Light Aircraft",
  private_jet: "Private Jet",
};

const TRAVEL_LOCATION_ALIASES: Record<string, string> = {
  argentina: "Argentina",
  canada: "Canada",
  cayman: "Cayman Islands",
  "cayman islands": "Cayman Islands",
  china: "China",
  hawaii: "Hawaii",
  japan: "Japan",
  mexico: "Mexico",
  "south africa": "South Africa",
  switzerland: "Switzerland",
  torn: TORN_LOCATION,
  uk: "United Kingdom",
  "united kingdom": "United Kingdom",
  uae: "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
};

type EnemyFactionMemberRow = {
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

type ParsedTravel = {
  origin: string;
  destination: string;
  flightLocation: string;
};

type TravelEstimate = {
  estimated_arrival_at: number | null;
  estimated_arrival_earliest: number | null;
  estimated_arrival_latest: number | null;
};

type TravelDisplay = {
  plane_type_label: string | null;
  travel_type: string | null;
  travel_type_note: string | null;
  travel_time_note: string | null;
  arrival_note: string | null;
  is_travel_time_range: boolean;
  return_travel_type: string | null;
  return_travel_time_seconds: number | null;
  return_travel_time_note: string | null;
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
  skipped: boolean;
};

type EnemyScoutingWar = {
  id: number;
  enemy_faction_id: number | null;
  enemy_scouting_auto_attempted_at: number | null;
};

type CurrentScoutingWar = {
  id: number;
  name: string;
  enemy_faction_id: number;
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

type EnemyPushSnapshotRow = {
  war_id: number;
  faction_id: number;
  bucket_start: number;
  total_members: number;
  online_count: number;
  idle_count: number;
  offline_count: number;
  recently_active_count: number;
  offline_idle_to_online_count: number;
  enemy_attacks_last_5m: number;
  hospital_count: number;
  revivable_count: number;
  baseline_active_count: number | null;
  activity_above_baseline: number | null;
  online_delta_10m: number;
  recently_active_delta_10m: number;
  pressure_score: number;
  pressure_level: string;
  created_at: number;
};

type EnemyPushSnapshotInput = Omit<EnemyPushSnapshotRow, "created_at">;

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
  const [homeMembers, enemyMembers] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, enemyFactionId),
  ]);

  return json({
    ok: true,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_finish_time: war.practical_finish_time,
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
  });
}

export async function getEnemyPushPressureForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const includeHistory = url.searchParams.get("include_history") !== "0";
  const latest = await readLatestEnemyPushSnapshot(env, war.id);
  const history = includeHistory ? await readEnemyPushHistory(env, war.id) : [];

  return json({
    ok: true,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_finish_time: war.practical_finish_time,
      official_end_time: war.official_end_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    latest,
    history,
  });
}

async function readLatestEnemyPushSnapshot(env: Env, warId: number): Promise<EnemyPushSnapshotRow | null> {
  return (await env.DB.prepare(
    `
    SELECT *
    FROM enemy_push_activity_snapshots
    WHERE war_id = ?
    ORDER BY bucket_start DESC
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as EnemyPushSnapshotRow | null;
}

async function readEnemyPushHistory(env: Env, warId: number): Promise<EnemyPushSnapshotRow[]> {
  const since = nowSeconds() - PUSH_HISTORY_SECONDS;
  return ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_push_activity_snapshots
    WHERE war_id = ?
      AND bucket_start >= ?
    ORDER BY bucket_start ASC
    `,
  )
    .bind(warId, since)
    .all()).results ?? []) as EnemyPushSnapshotRow[];
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

export async function refreshCurrentEnemyMemberTracking(
  env: Env,
  options: { includeMembers?: boolean; liveOnly?: boolean } = {},
): Promise<EnemyMemberTrackingRefreshMetrics> {
  const war = await readCurrentScoutingWar(env);
  if (!war) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: null,
    };
  }

  const checkedAt = nowSeconds();
  if (options.liveOnly && !isWarRoomMemberTrackingLive(war, checkedAt)) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: war.enemy_faction_id,
    };
  }

  if (!isWarRoomMemberTrackingActive(war, checkedAt)) {
    const clearMetrics =
      war.practical_finish_time !== null && checkedAt > war.practical_finish_time
        ? await clearLiveEnemyTrackingData(env, war.id, war.enemy_faction_id)
        : { writeStatements: 0, changedRows: 0 };
    return {
      writeStatements: clearMetrics.writeStatements,
      changedRows: clearMetrics.changedRows,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
      factionId: war.enemy_faction_id,
    };
  }

  return refreshEnemyFactionMemberStatuses(
    env,
    war.id,
    war.name,
    war.enemy_faction_id,
    war.enemy_scouting_status_checked_at,
    { includeMembers: options.includeMembers },
  );
}

export async function refreshMissingFfscouterEstimates(env: Env): Promise<FfscouterRefreshMetrics> {
  const metrics: FfscouterRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    enemyCandidates: 0,
    homeCandidates: 0,
    enemyUpdated: 0,
    homeUpdated: 0,
    skipped: false,
  };
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...metrics, skipped: true };
  }

  const completeLatchName = enemyTargetFfFillCompleteLatchName(
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
  );
  if (await isSyncLatchSet(env, completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const enemyRows = (await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND ff_battlestats IS NULL
    ORDER BY level DESC, name ASC
    `,
  )
    .bind(scoutingWar.enemy_faction_id)
    .all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.enemyCandidates = enemyRows?.length ?? 0;
  const enemyMetrics = await refreshMissingFfBattlestats(env, enemyRows ?? []);
  metrics.writeStatements += enemyMetrics.writeStatements;
  metrics.changedRows += enemyMetrics.changedRows;
  metrics.enemyUpdated += enemyMetrics.changedRows;

  const homeRows = (await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE ff_battlestats IS NULL
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.homeCandidates = homeRows?.length ?? 0;
  const homeMetrics = await refreshMissingFfBattlestats(env, homeRows ?? [], "home_faction_members");
  metrics.writeStatements += homeMetrics.writeStatements;
  metrics.changedRows += homeMetrics.changedRows;
  metrics.homeUpdated += homeMetrics.changedRows;

  if (metrics.enemyCandidates + metrics.homeCandidates === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
  }

  return metrics;
}

export async function refreshMissingBspBattlestatPredictions(
  env: Env,
  options: { limit?: number } = {},
): Promise<BspBattlestatRefreshMetrics> {
  const metrics: BspBattlestatRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: false,
  };
  if (!env.BSP_TORN_API_KEY) {
    return { ...metrics, skipped: true };
  }

  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...metrics, skipped: true };
  }

  const completeLatchName = enemyTargetBspFillCompleteLatchName(
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
  );
  if (await isSyncLatchSet(env, completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const enemyMetrics = await refreshMissingBspBattlestatPredictionsForFaction(
    env,
    "enemy_faction_members",
    scoutingWar.enemy_faction_id,
    undefined,
    options,
  );
  addBspBattlestatMetrics(metrics, enemyMetrics);

  const homeMetrics = await refreshMissingBspBattlestatPredictionsForFaction(
    env,
    "home_faction_members",
    HOME_FACTION_ID,
    undefined,
    options,
  );
  addBspBattlestatMetrics(metrics, homeMetrics);

  if (metrics.candidates === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
  }

  return metrics;
}

function addBspBattlestatMetrics(
  target: BspBattlestatRefreshMetrics,
  source: BspBattlestatRefreshMetrics,
): void {
  target.writeStatements += source.writeStatements;
  target.changedRows += source.changedRows;
  target.candidates += source.candidates;
  target.updated += source.updated;
}

async function refreshMissingBspBattlestatPredictionsForFaction(
  env: Env,
  tableName: "enemy_faction_members" | "home_faction_members",
  factionId: number,
  rows?: EnemyFactionMemberRow[],
  options: { limit?: number } = {},
): Promise<BspBattlestatRefreshMetrics> {
  const metrics: BspBattlestatRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: false,
  };
  if (!env.BSP_TORN_API_KEY) {
    return { ...metrics, skipped: true };
  }

  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? BSP_BATTLESTAT_REFRESH_LIMIT), BSP_BATTLESTAT_REFRESH_LIMIT),
  );
  const candidateRows = rows
    ? rows
        .filter((row) => row.faction_id === factionId && row.bsp_battlestats_updated_at == null)
        .slice(0, limit)
    : ((await env.DB.prepare(
        `
        SELECT *
        FROM ${tableName}
        WHERE faction_id = ?
          AND bsp_battlestats_updated_at IS NULL
        ORDER BY ff_battlestats DESC NULLS LAST, level DESC, name ASC
        LIMIT ?
        `,
      )
        .bind(factionId, limit)
        .all()).results ?? []) as EnemyFactionMemberRow[];

  metrics.candidates = candidateRows.length;

  for (const row of candidateRows) {
    const prediction = await fetchBspBattlestatPrediction(env, row.member_id).catch((err) => {
      console.warn(`BSP battlestat prediction fetch failed for ${row.member_id}:`, err?.message || err);
      return null;
    });

    if (!prediction) {
      continue;
    }

    const result = await env.DB.prepare(
      `
      UPDATE ${tableName}
      SET bsp_battlestats = ?,
          bsp_battlestats_updated_at = unixepoch(),
          updated_at = unixepoch()
      WHERE faction_id = ?
        AND member_id = ?
        AND bsp_battlestats_updated_at IS NULL
      `,
    )
      .bind(
        prediction,
        factionId,
        row.member_id,
      )
      .run();

    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.updated += changes;
  }

  return metrics;
}

export async function refreshMissingScoutingNetworth(
  env: Env,
  options: { limit?: number } = {},
): Promise<ScoutingNetworthRefreshMetrics> {
  const metrics: ScoutingNetworthRefreshMetrics = {
    writeStatements: 0,
    changedRows: 0,
    candidates: 0,
    updated: 0,
    skipped: false,
  };
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { ...metrics, skipped: true };
  }

  const completeLatchName = enemyTargetNetworthFillCompleteLatchName(
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
  );
  if (await isSyncLatchSet(env, completeLatchName)) {
    return { ...metrics, skipped: true };
  }

  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? NETWORTH_REFRESH_LIMIT), NETWORTH_REFRESH_LIMIT),
  );
  const rows = ((await env.DB.prepare(
    `
    SELECT *
    FROM enemy_faction_members
    WHERE faction_id = ?
      AND networth_updated_at IS NULL
    ORDER BY level DESC, name ASC
    LIMIT ?
    `,
  )
    .bind(scoutingWar.enemy_faction_id, limit)
    .all()).results ?? []) as EnemyFactionMemberRow[];

  metrics.candidates = rows.length;
  if (rows.length === 0) {
    await setSyncLatch(env, completeLatchName, nowSeconds());
    return metrics;
  }

  for (const row of rows) {
    const stats = await fetchTornPersonalStats(env, row.member_id, ["networth"]);
    const networth = finiteNumber(stats.networth);

    const result = await env.DB.prepare(
      `
      UPDATE enemy_faction_members
      SET networth = ?,
          networth_updated_at = unixepoch(),
          updated_at = unixepoch()
      WHERE faction_id = ?
        AND member_id = ?
        AND networth_updated_at IS NULL
      `,
    )
      .bind(networth, scoutingWar.enemy_faction_id, row.member_id)
      .run();
    const changes = d1Changes(result);
    metrics.writeStatements += 1;
    metrics.changedRows += changes;
    metrics.updated += changes;
  }

  return metrics;
}

export async function sendPendingEnemyStatsComparisonImage(
  env: Env,
): Promise<{ sent: boolean; skipped: boolean; reason?: string }> {
  const scoutingWar = await readCurrentScoutingWar(env);
  if (!scoutingWar) {
    return { sent: false, skipped: true, reason: "no current scouting war" };
  }

  const pendingLatchName = enemyTargetStatsImagePendingLatchName(
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
  );
  if (!(await isSyncLatchSet(env, pendingLatchName))) {
    return { sent: false, skipped: true, reason: "no pending image" };
  }

  const sentLatchName = enemyTargetStatsImageSentLatchName(
    scoutingWar.id,
    scoutingWar.enemy_faction_id,
  );
  if (await isSyncLatchSet(env, sentLatchName)) {
    await clearSyncLatch(env, pendingLatchName);
    return { sent: false, skipped: true, reason: "already sent" };
  }

  const ready = await areEnemyTargetStatsComplete(env, scoutingWar.id, scoutingWar.enemy_faction_id);
  if (!ready) {
    return { sent: false, skipped: true, reason: "stats still filling" };
  }

  const [homeMembers, enemyMembers] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, scoutingWar.enemy_faction_id),
  ]);
  const svg = buildStatsComparisonSvg({
    enemyName: scoutingWar.name,
    homeMembers,
    enemyMembers,
  });

  await sendDiscordMessageWithAttachment(env, {
    content: `Enemy stats comparison ready: ${scoutingWar.name}`,
    filename: `enemy-stats-comparison-${scoutingWar.id}.svg`,
    mimeType: "image/svg+xml",
    data: svg,
  });

  await setSyncLatch(env, sentLatchName, nowSeconds());
  await clearSyncLatch(env, pendingLatchName);
  return { sent: true, skipped: false };
}

async function areEnemyTargetStatsComplete(
  env: Env,
  warId: number,
  enemyFactionId: number,
): Promise<boolean> {
  const latchNames = [
    enemyTargetFfFillCompleteLatchName(warId, enemyFactionId),
    enemyTargetBspFillCompleteLatchName(warId, enemyFactionId),
    enemyTargetNetworthFillCompleteLatchName(warId, enemyFactionId),
  ];

  const results = await Promise.all(latchNames.map((name) => isSyncLatchSet(env, name)));
  return results.every(Boolean);
}

function buildStatsComparisonSvg({
  enemyName,
  homeMembers,
  enemyMembers,
}: {
  enemyName: string;
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
}): string {
  const width = 1200;
  const panelHeight = 245;
  const headerHeight = 95;
  const footerHeight = 35;
  const height = headerHeight + panelHeight * 3 + footerHeight;
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16);
  const panels = [
    renderStatsPanel({
      y: headerHeight,
      title: "FF stats",
      metric: "ff_battlestats",
      buckets: BATTLE_STATS_BUCKETS,
      homeMembers,
      enemyMembers,
      enemyName,
    }),
    renderStatsPanel({
      y: headerHeight + panelHeight,
      title: "BSP stats",
      metric: "bsp_battlestats",
      buckets: BATTLE_STATS_BUCKETS,
      homeMembers,
      enemyMembers,
      enemyName,
    }),
    renderStatsPanel({
      y: headerHeight + panelHeight * 2,
      title: "Networth",
      metric: "networth",
      buckets: NETWORTH_BUCKETS,
      homeMembers,
      enemyMembers,
      enemyName,
    }),
  ].join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Enemy stats comparison">`,
    "<rect width=\"1200\" height=\"865\" fill=\"#f8fafc\"/>",
    "<rect x=\"24\" y=\"20\" width=\"1152\" height=\"62\" rx=\"10\" fill=\"#0f172a\"/>",
    `<text x="48" y="48" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${escapeSvg(enemyName)} stats comparison</text>`,
    `<text x="48" y="70" font-family="Arial, sans-serif" font-size="13" fill="#cbd5e1">Generated ${escapeSvg(generatedAt)} UTC after FF, BSP, and networth fills completed</text>`,
    "<rect x=\"870\" y=\"34\" width=\"14\" height=\"14\" rx=\"3\" fill=\"#2563eb\"/>",
    `<text x="892" y="46" font-family="Arial, sans-serif" font-size="13" fill="#e2e8f0">${escapeSvg(HOME_STATS_LABEL)}</text>`,
    "<rect x=\"1010\" y=\"34\" width=\"14\" height=\"14\" rx=\"3\" fill=\"#dc2626\"/>",
    `<text x="1032" y="46" font-family="Arial, sans-serif" font-size="13" fill="#e2e8f0">${escapeSvg(enemyName)}</text>`,
    panels,
    "</svg>",
  ].join("");
}

function renderStatsPanel({
  y,
  title,
  metric,
  buckets,
  homeMembers,
  enemyMembers,
  enemyName,
}: {
  y: number;
  title: string;
  metric: ScoutingComparisonMetric;
  buckets: ScoutingBucket[];
  homeMembers: EnemyFactionMemberRow[];
  enemyMembers: EnemyFactionMemberRow[];
  enemyName: string;
}): string {
  const left = 48;
  const top = y + 12;
  const chartTop = y + 64;
  const rowHeight = 14;
  const gap = 7;
  const bucketLabelWidth = 88;
  const barLeft = left + bucketLabelWidth;
  const barWidth = 890;
  const homeValues = buildBucketCounts(homeMembers, buckets, metric);
  const enemyValues = buildBucketCounts(enemyMembers, buckets, metric);
  const maxValue = Math.max(1, ...homeValues, ...enemyValues);
  const homeCoverage = metricCoverage(homeMembers, metric);
  const enemyCoverage = metricCoverage(enemyMembers, metric);
  const homeAverage = metricAverage(homeMembers, metric);
  const enemyAverage = metricAverage(enemyMembers, metric);
  const rows = buckets.map((bucket, index) => {
    const rowY = chartTop + index * (rowHeight + gap);
    const homeWidth = Math.round((homeValues[index] / maxValue) * barWidth);
    const enemyWidth = Math.round((enemyValues[index] / maxValue) * barWidth);
    return [
      `<text x="${left}" y="${rowY + 11}" font-family="Arial, sans-serif" font-size="11" fill="#475569">${escapeSvg(bucket.label)}</text>`,
      `<rect x="${barLeft}" y="${rowY}" width="${barWidth}" height="${rowHeight * 2 + 2}" rx="3" fill="#e2e8f0"/>`,
      `<rect x="${barLeft}" y="${rowY}" width="${homeWidth}" height="${rowHeight}" rx="3" fill="#2563eb"/>`,
      `<rect x="${barLeft}" y="${rowY + rowHeight + 2}" width="${enemyWidth}" height="${rowHeight}" rx="3" fill="#dc2626"/>`,
      `<text x="${barLeft + barWidth + 12}" y="${rowY + 11}" font-family="Arial, sans-serif" font-size="11" fill="#334155">${homeValues[index]}</text>`,
      `<text x="${barLeft + barWidth + 12}" y="${rowY + rowHeight + 13}" font-family="Arial, sans-serif" font-size="11" fill="#334155">${enemyValues[index]}</text>`,
    ].join("");
  }).join("");

  return [
    `<rect x="24" y="${y}" width="1152" height="230" rx="10" fill="#ffffff" stroke="#dbe4ee"/>`,
    `<text x="${left}" y="${top + 18}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">${escapeSvg(title)}</text>`,
    `<text x="${left + 180}" y="${top + 18}" font-family="Arial, sans-serif" font-size="12" fill="#475569">${escapeSvg(HOME_STATS_LABEL)} ${homeCoverage.available}/${homeCoverage.total} avg ${escapeSvg(formatCompactNumber(homeAverage))}</text>`,
    `<text x="${left + 485}" y="${top + 18}" font-family="Arial, sans-serif" font-size="12" fill="#475569">${escapeSvg(enemyName)} ${enemyCoverage.available}/${enemyCoverage.total} avg ${escapeSvg(formatCompactNumber(enemyAverage))}</text>`,
    rows,
  ].join("");
}

function buildBucketCounts(
  members: EnemyFactionMemberRow[],
  buckets: ScoutingBucket[],
  metric: ScoutingComparisonMetric,
): number[] {
  return buckets.map(
    (bucket) =>
      members.filter((member) => {
        if (!hasScoutingMetricValue(member, metric)) {
          return false;
        }
        const value = Number(member[metric] ?? 0);
        return Number.isFinite(value) && value >= bucket.min && value < bucket.max;
      }).length,
  );
}

function metricCoverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): { available: number; total: number } {
  return {
    available: members.filter((member) => hasScoutingMetricValue(member, metric)).length,
    total: members.length,
  };
}

function metricAverage(
  members: EnemyFactionMemberRow[],
  metric: ScoutingComparisonMetric,
): number | null {
  const values = members
    .map((member) => Number(member[metric] ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function hasScoutingMetricValue(
  member: EnemyFactionMemberRow,
  metric: ScoutingComparisonMetric,
): boolean {
  const value = Number(member[metric] ?? 0);
  return Number.isFinite(value) && value > 0;
}

function formatCompactNumber(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${trimNumber(value / 1_000_000_000_000)}t`;
  if (abs >= 1_000_000_000) return `${trimNumber(value / 1_000_000_000)}b`;
  if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${trimNumber(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimNumber(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      enemy_faction_id,
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

async function readWarFromScoutingUrl(url: URL, env: Env): Promise<WarRow | Response> {
  const name = decodeURIComponent(url.pathname.split("/")[3] ?? "").trim();

  if (!name) {
    return json({ ok: false, error: "Invalid war name", code: "INVALID_WAR_NAME" }, 400);
  }

  const war = (await env.DB.prepare(
    `
    SELECT *
    FROM wars
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as WarRow | null;

  if (!war) {
    return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
  }

  if (war.enemy_faction_id === null) {
    return json(
      { ok: false, error: "War does not have an enemy faction ID", code: "MISSING_ENEMY_FACTION" },
      400,
    );
  }

  return war;
}

async function readEnemyScouting(
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

async function readHomeScouting(env: Env): Promise<EnemyFactionMemberRow[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE faction_id = ?
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
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
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

  const rows = (await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE ff_battlestats IS NULL
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  await refreshMissingFfBattlestats(env, rows ?? [], "home_faction_members");
}

async function refreshEnemyFactionMemberStatuses(
  env: Env,
  warId: number,
  warName: string,
  factionId: number,
  previousPollAt: number | null,
  options: { members?: TornFactionMember[]; includeMembers?: boolean } = {},
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
  await sendEnemyPushAlerts(env, warId, warName, pushSnapshot).catch((err) => {
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

async function buildEnemyPushSnapshot(
  env: Env,
  warId: number,
  factionId: number,
  members: TornFactionMember[],
  existingById: Map<number, EnemyFactionMemberRow>,
  fetchedAt: number,
): Promise<EnemyPushSnapshotInput> {
  let onlineCount = 0;
  let idleCount = 0;
  let offlineCount = 0;
  let recentlyActiveCount = 0;
  let offlineIdleToOnlineCount = 0;
  let hospitalCount = 0;
  let revivableCount = 0;

  for (const member of members) {
    const actionStatus = normalizeLastActionStatus(member.last_action?.status);
    const previousActionStatus = normalizeLastActionStatus(existingById.get(member.id)?.last_action_status);
    if (actionStatus === "online") {
      onlineCount += 1;
      if (previousActionStatus === "offline" || previousActionStatus === "idle") {
        offlineIdleToOnlineCount += 1;
      }
    } else if (actionStatus === "idle") {
      idleCount += 1;
    } else if (actionStatus === "offline") {
      offlineCount += 1;
    }

    const lastActionTimestamp = finiteNumber(member.last_action?.timestamp);
    if (
      lastActionTimestamp !== null &&
      lastActionTimestamp > 0 &&
      fetchedAt - lastActionTimestamp <= PUSH_RECENT_ACTIVITY_WINDOW_SECONDS
    ) {
      recentlyActiveCount += 1;
    }

    if (member.status?.state === "Hospital") {
      hospitalCount += 1;
    }

    if (member.is_revivable) {
      revivableCount += 1;
    }
  }

  const bucketStart = Math.floor(fetchedAt / 60) * 60;
  const [reference, baselineActiveCount, enemyAttacksLast5m] = await Promise.all([
    readEnemyPushReferenceSnapshot(env, warId, bucketStart - PUSH_REFERENCE_WINDOW_SECONDS),
    readEnemyActivityBaseline(env, factionId, bucketStart),
    readEnemyAttacksLast5m(env, warId, factionId, fetchedAt),
  ]);
  const onlineDelta10m = reference ? onlineCount - Number(reference.online_count ?? 0) : 0;
  const recentlyActiveDelta10m = reference
    ? recentlyActiveCount - Number(reference.recently_active_count ?? 0)
    : 0;
  const activityAboveBaseline =
    baselineActiveCount === null ? null : recentlyActiveCount - baselineActiveCount;
  const pressureScore = calculatePushPressureScore({
    totalMembers: members.length,
    onlineDelta10m,
    recentlyActiveCount,
    recentlyActiveDelta10m,
    offlineIdleToOnlineCount,
    activityAboveBaseline,
    enemyAttacksLast5m,
  });

  return {
    war_id: warId,
    faction_id: factionId,
    bucket_start: bucketStart,
    total_members: members.length,
    online_count: onlineCount,
    idle_count: idleCount,
    offline_count: offlineCount,
    recently_active_count: recentlyActiveCount,
    offline_idle_to_online_count: offlineIdleToOnlineCount,
    enemy_attacks_last_5m: enemyAttacksLast5m,
    hospital_count: hospitalCount,
    revivable_count: revivableCount,
    baseline_active_count: baselineActiveCount,
    activity_above_baseline: activityAboveBaseline,
    online_delta_10m: onlineDelta10m,
    recently_active_delta_10m: recentlyActiveDelta10m,
    pressure_score: pressureScore,
    pressure_level: pushPressureLevel(pressureScore, enemyAttacksLast5m),
  };
}

async function readEnemyPushReferenceSnapshot(
  env: Env,
  warId: number,
  referenceAt: number,
): Promise<Pick<EnemyPushSnapshotRow, "online_count" | "recently_active_count"> | null> {
  return (await env.DB.prepare(
    `
    SELECT online_count, recently_active_count
    FROM enemy_push_activity_snapshots
    WHERE war_id = ?
      AND bucket_start <= ?
    ORDER BY bucket_start DESC
    LIMIT 1
    `,
  )
    .bind(warId, referenceAt)
    .first()) as Pick<EnemyPushSnapshotRow, "online_count" | "recently_active_count"> | null;
}

async function readEnemyActivityBaseline(
  env: Env,
  factionId: number,
  sampledAt: number,
): Promise<number | null> {
  const bucket = activityHeatmapInterval(sampledAt);
  const row = (await env.DB.prepare(
    `
    SELECT AVG(active_count) AS active_count
    FROM faction_activity_heatmap
    WHERE faction_id = ?
      AND interval_index = ?
    `,
  )
    .bind(factionId, bucket)
    .first()) as { active_count: number | null } | null;

  return finiteNumber(row?.active_count);
}

async function readEnemyAttacksLast5m(
  env: Env,
  warId: number,
  factionId: number,
  fetchedAt: number,
): Promise<number> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS attacks
    FROM attacks
    WHERE war_id = ?
      AND attacker_faction_id = ?
      AND defender_faction_id = ?
      AND started >= ?
      AND started <= ?
    `,
  )
    .bind(warId, factionId, HOME_FACTION_ID, fetchedAt - PUSH_RECENT_ACTIVITY_WINDOW_SECONDS, fetchedAt)
    .first()) as { attacks: number | null } | null;

  return Math.max(0, Math.floor(Number(row?.attacks ?? 0)));
}

function upsertEnemyPushSnapshot(env: Env, snapshot: EnemyPushSnapshotInput): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO enemy_push_activity_snapshots (
      war_id,
      faction_id,
      bucket_start,
      total_members,
      online_count,
      idle_count,
      offline_count,
      recently_active_count,
      offline_idle_to_online_count,
      enemy_attacks_last_5m,
      hospital_count,
      revivable_count,
      baseline_active_count,
      activity_above_baseline,
      online_delta_10m,
      recently_active_delta_10m,
      pressure_score,
      pressure_level,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(war_id, bucket_start) DO UPDATE SET
      faction_id = excluded.faction_id,
      total_members = excluded.total_members,
      online_count = excluded.online_count,
      idle_count = excluded.idle_count,
      offline_count = excluded.offline_count,
      recently_active_count = excluded.recently_active_count,
      offline_idle_to_online_count = excluded.offline_idle_to_online_count,
      enemy_attacks_last_5m = excluded.enemy_attacks_last_5m,
      hospital_count = excluded.hospital_count,
      revivable_count = excluded.revivable_count,
      baseline_active_count = excluded.baseline_active_count,
      activity_above_baseline = excluded.activity_above_baseline,
      online_delta_10m = excluded.online_delta_10m,
      recently_active_delta_10m = excluded.recently_active_delta_10m,
      pressure_score = excluded.pressure_score,
      pressure_level = excluded.pressure_level,
      created_at = excluded.created_at
    `,
  ).bind(
    snapshot.war_id,
    snapshot.faction_id,
    snapshot.bucket_start,
    snapshot.total_members,
    snapshot.online_count,
    snapshot.idle_count,
    snapshot.offline_count,
    snapshot.recently_active_count,
    snapshot.offline_idle_to_online_count,
    snapshot.enemy_attacks_last_5m,
    snapshot.hospital_count,
    snapshot.revivable_count,
    snapshot.baseline_active_count,
    snapshot.activity_above_baseline,
    snapshot.online_delta_10m,
    snapshot.recently_active_delta_10m,
    snapshot.pressure_score,
    snapshot.pressure_level,
  );
}

function calculatePushPressureScore(values: {
  totalMembers: number;
  onlineDelta10m: number;
  recentlyActiveCount: number;
  recentlyActiveDelta10m: number;
  offlineIdleToOnlineCount: number;
  activityAboveBaseline: number | null;
  enemyAttacksLast5m: number;
}): number {
  const activeClusterThreshold = Math.max(4, Math.ceil(values.totalMembers * 0.12));
  const activeClusterScore = Math.max(0, values.recentlyActiveCount - activeClusterThreshold);
  const baselineScore =
    values.activityAboveBaseline === null ? 0 : Math.max(0, Math.floor(values.activityAboveBaseline));

  return (
    Math.max(0, values.onlineDelta10m) +
    Math.max(0, values.recentlyActiveDelta10m) +
    values.offlineIdleToOnlineCount * 2 +
    values.enemyAttacksLast5m * 3 +
    activeClusterScore +
    baselineScore
  );
}

function pushPressureLevel(score: number, enemyAttacksLast5m: number): string {
  if (enemyAttacksLast5m >= 5 || (enemyAttacksLast5m >= 2 && score >= 10)) {
    return "underway";
  }
  if (score >= 16) {
    return "likely";
  }
  if (score >= 7) {
    return "building";
  }
  return "quiet";
}

async function sendEnemyPushAlerts(
  env: Env,
  warId: number,
  warName: string,
  snapshot: EnemyPushSnapshotInput,
): Promise<void> {
  const likelyStateName = `${PUSH_ALERT_STATE_PREFIX}:${warId}:likely`;
  const underwayStateName = `${PUSH_ALERT_STATE_PREFIX}:${warId}:underway`;

  if (snapshot.pressure_level === "underway") {
    await clearEnemyPushAlert(env, likelyStateName);
    await sendEnemyPushAlertIfNeeded(env, underwayStateName, formatEnemyPushAlertMessage("underway", warName, snapshot), snapshot.bucket_start);
    return;
  }

  await clearEnemyPushAlert(env, underwayStateName);
  if (snapshot.pressure_level === "likely") {
    await sendEnemyPushAlertIfNeeded(env, likelyStateName, formatEnemyPushAlertMessage("likely", warName, snapshot), snapshot.bucket_start);
    return;
  }

  await clearEnemyPushAlert(env, likelyStateName);
}

async function sendEnemyPushAlertIfNeeded(
  env: Env,
  stateName: string,
  message: string,
  sentAt: number,
): Promise<void> {
  if (await isSyncLatchSet(env, stateName)) {
    return;
  }

  await sendDiscordMessage(env, message);
  await setSyncLatch(env, stateName, sentAt);
}

async function clearEnemyPushAlert(env: Env, stateName: string): Promise<void> {
  await clearSyncLatch(env, stateName);
}

function formatEnemyPushAlertMessage(
  alertType: "likely" | "underway",
  warName: string,
  snapshot: EnemyPushSnapshotInput,
): string {
  const headline =
    alertType === "underway"
      ? `WIP enemy push alert: push appears to be happening currently for ${warName}.`
      : `WIP enemy push alert: push is likely happening soon for ${warName}.`;
  const reasons = enemyPushAlertReasons(snapshot);
  return `${PUSH_ALERT_USER_MENTION} ${headline} Score ${snapshot.pressure_score}.${reasons ? ` ${reasons}` : ""}`;
}

function enemyPushAlertReasons(snapshot: EnemyPushSnapshotInput): string {
  const reasons: string[] = [];
  if (snapshot.enemy_attacks_last_5m > 0) {
    reasons.push(`${snapshot.enemy_attacks_last_5m} enemy attacks in 5m`);
  }
  if (snapshot.online_delta_10m > 0) {
    reasons.push(`+${snapshot.online_delta_10m} online in 10m`);
  }
  if (snapshot.offline_idle_to_online_count > 0) {
    reasons.push(`${snapshot.offline_idle_to_online_count} Offline/Idle -> Online`);
  }
  if (snapshot.recently_active_delta_10m > 0) {
    reasons.push(`+${snapshot.recently_active_delta_10m} recently active vs 10m ago`);
  }
  return reasons.length > 0 ? `Signals: ${reasons.join("; ")}.` : "";
}

function normalizeLastActionStatus(value: unknown): "online" | "idle" | "offline" | "other" {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (status === "online") {
    return "online";
  }
  if (status === "idle") {
    return "idle";
  }
  if (status === "offline") {
    return "offline";
  }
  return "other";
}

function activityHeatmapInterval(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.floor(minutes / HEATMAP_INTERVAL_MINUTES);
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
  const stateName = `${LIVE_ENEMY_TRACKING_CLEAR_STATE_PREFIX}:${warId}`;
  if (await hasSyncState(env, stateName)) {
    return { writeStatements: 0, changedRows: 0 };
  }

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

  await upsertSyncTimestamp(env, stateName, nowSeconds(), warId);

  return {
    writeStatements: 4,
    changedRows:
      d1Changes(memberResult) +
      d1Changes(pushSnapshotResult) +
      d1Changes(pushAlertResult) +
      1,
  };
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

  const startedAfter = previousPollAt ?? previous?.status_updated_at ?? null;
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

function parseTravelDescription(description: string | null): ParsedTravel | null {
  if (!description) {
    return null;
  }

  const outbound = /^Traveling to (.+)$/i.exec(description);
  if (outbound) {
    const destination = normalizeTravelLocation(outbound[1]);
    if (!destination || destination === TORN_LOCATION) {
      return null;
    }
    return {
      origin: TORN_LOCATION,
      destination,
      flightLocation: destination,
    };
  }

  const explicitOutbound = /^Traveling from Torn to (.+)$/i.exec(description);
  if (explicitOutbound) {
    const destination = normalizeTravelLocation(explicitOutbound[1]);
    if (!destination || destination === TORN_LOCATION) {
      return null;
    }
    return {
      origin: TORN_LOCATION,
      destination,
      flightLocation: destination,
    };
  }

  const returning = /^Traveling from (.+) to Torn$/i.exec(description);
  if (returning) {
    const origin = normalizeTravelLocation(returning[1]);
    if (!origin || origin === TORN_LOCATION) {
      return null;
    }
    return {
      origin,
      destination: TORN_LOCATION,
      flightLocation: origin,
    };
  }

  return null;
}

function normalizeTravelLocation(value: string | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return null;
  }

  return TRAVEL_LOCATION_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

function parseAbroadLocation(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const match =
    /^In (.+)$/i.exec(description) ??
    /^Abroad in (.+)$/i.exec(description) ??
    /^Currently in (.+)$/i.exec(description);
  const location = normalizeTravelLocation(match?.[1] ?? description);
  return location === TORN_LOCATION ? null : location;
}

function initialTravelTripType(planeImageType: string | null): StoredTravelTripType | null {
  if (planeImageType === "airliner") {
    return "Business Class/Standard";
  }

  const durationKey = planeImageType ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[planeImageType] : undefined;
  return durationKey ?? null;
}

function parseStoredTravelTripType(value: string | null | undefined): StoredTravelTripType | null {
  if (
    value === "Standard" ||
    value === "Airstrip" ||
    value === "WLT benefit" ||
    value === "Business Class" ||
    value === "Business Class/Standard"
  ) {
    return value;
  }

  return null;
}

function resolveTravelTripType(
  flightLocation: string,
  planeImageType: string | null,
  startedBefore: number,
  currentType: StoredTravelTripType | null,
  currentInferredAt: number | null,
  fetchedAt: number,
): { type: StoredTravelTripType | null; inferredAt: number | null } {
  if (planeImageType !== "airliner" || currentType !== "Business Class/Standard") {
    return { type: currentType, inferredAt: currentInferredAt };
  }

  const businessClassMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.["Business Class"];
  if (!businessClassMinutes) {
    return { type: currentType, inferredAt: currentInferredAt };
  }

  const businessClassLatestArrival = startedBefore + businessClassMinutes * 60;
  if (fetchedAt > businessClassLatestArrival + BUSINESS_CLASS_RESOLUTION_GRACE_SECONDS) {
    return { type: "Standard", inferredAt: currentInferredAt ?? fetchedAt };
  }

  return { type: currentType, inferredAt: currentInferredAt };
}

function estimateTravelArrival(
  flightLocation: string,
  planeImageType: string | null,
  startedAfter: number | null,
  startedBefore: number,
  tripType: StoredTravelTripType | null = null,
): TravelEstimate {
  if (planeImageType === "airliner") {
    const businessClassMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.["Business Class"];
    const standardMinutes = TRAVEL_DURATIONS_MINUTES[flightLocation]?.Standard;
    if (!businessClassMinutes || !standardMinutes) {
      return {
        estimated_arrival_at: null,
        estimated_arrival_earliest: null,
        estimated_arrival_latest: null,
      };
    }

    if (tripType === "Standard" || tripType === "Business Class") {
      const durationMinutes = tripType === "Standard" ? standardMinutes : businessClassMinutes;
      const durationSeconds = durationMinutes * 60;
      const estimatedLatest = startedBefore + durationSeconds;
      const estimatedEarliest = startedAfter === null ? null : startedAfter + durationSeconds;
      const estimatedArrival =
        estimatedEarliest === null
          ? estimatedLatest
          : Math.floor((estimatedEarliest + estimatedLatest) / 2);

      return {
        estimated_arrival_at: estimatedArrival,
        estimated_arrival_earliest: estimatedEarliest,
        estimated_arrival_latest: estimatedLatest,
      };
    }

    const estimatedEarliest =
      startedAfter === null ? null : startedAfter + businessClassMinutes * 60;
    const estimatedLatest = startedBefore + standardMinutes * 60;
    const estimatedArrival =
      estimatedEarliest === null
        ? estimatedLatest
        : Math.floor((estimatedEarliest + estimatedLatest) / 2);

    return {
      estimated_arrival_at: estimatedArrival,
      estimated_arrival_earliest: estimatedEarliest,
      estimated_arrival_latest: estimatedLatest,
    };
  }

  const durationKey = planeImageType ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[planeImageType] : undefined;
  const durationMinutes = durationKey ? TRAVEL_DURATIONS_MINUTES[flightLocation]?.[durationKey] : undefined;
  if (!durationMinutes) {
    return {
      estimated_arrival_at: null,
      estimated_arrival_earliest: null,
      estimated_arrival_latest: null,
    };
  }

  const durationSeconds = durationMinutes * 60;
  const estimatedLatest = startedBefore + durationSeconds;
  const estimatedEarliest = startedAfter === null ? null : startedAfter + durationSeconds;
  const estimatedArrival =
    estimatedEarliest === null
      ? estimatedLatest
      : Math.floor((estimatedEarliest + estimatedLatest) / 2);

  return {
    estimated_arrival_at: estimatedArrival,
    estimated_arrival_earliest: estimatedEarliest,
    estimated_arrival_latest: estimatedLatest,
  };
}

function buildTravelDisplay(row: EnemyFactionMemberRow): TravelDisplay {
  const planeTypeLabel = formatPlaneImageType(row.plane_image_type);
  const tripType = parseStoredTravelTripType(row.travel_trip_type);
  const returnTravelTimeSeconds = returnTravelDurationSeconds(row.travel_trip_destination, tripType);
  const returnTravelType =
    tripType === "Business Class/Standard" ? "Business Class minimum" : (tripType ?? null);
  const returnTravelTimeNote =
    row.status_state === "Abroad" && row.travel_trip_destination
      ? `Minimum return time from ${row.travel_trip_destination} if leaving now.`
      : null;

  if (row.plane_image_type === "airliner") {
    if (tripType === "Standard" || tripType === "Business Class") {
      return {
        plane_type_label: planeTypeLabel,
        travel_type: tripType,
        travel_type_note:
          tripType === "Standard"
            ? `${planeTypeLabel ?? "Airliner"}; Standard inferred because Business Class timing was ruled out.`
            : planeTypeLabel,
        travel_time_note: tripType,
        arrival_note: row.status_description ?? "Travel arrival estimate",
        is_travel_time_range: false,
        return_travel_type: returnTravelType,
        return_travel_time_seconds: returnTravelTimeSeconds,
        return_travel_time_note: returnTravelTimeNote,
      };
    }

    const note = "Torn reports both Standard and Business Class flights as airliner.";
    return {
      plane_type_label: planeTypeLabel,
      travel_type: "Business Class/Standard",
      travel_type_note: `${planeTypeLabel ?? "Airliner"}; ${note}`,
      travel_time_note:
        "Airliner can be either Business Class or Standard. Travel time range shows Business Class fastest and Standard slowest.",
      arrival_note:
        "Arrival range uses Business Class for earliest arrival and Standard for latest arrival because Torn reports both as airliner.",
      is_travel_time_range: true,
      return_travel_type: returnTravelType,
      return_travel_time_seconds: returnTravelTimeSeconds,
      return_travel_time_note: returnTravelTimeNote,
    };
  }

  const durationKey = row.plane_image_type
    ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[row.plane_image_type]
    : undefined;
  const travelType = durationKey ?? null;

  return {
    plane_type_label: planeTypeLabel,
    travel_type: row.status_state === "Abroad" ? (tripType ?? travelType) : travelType,
    travel_type_note: planeTypeLabel,
    travel_time_note: travelType ?? planeTypeLabel,
    arrival_note: row.status_description ?? "Travel arrival estimate",
    is_travel_time_range: false,
    return_travel_type: returnTravelType,
    return_travel_time_seconds: returnTravelTimeSeconds,
    return_travel_time_note: returnTravelTimeNote,
  };
}

function returnTravelDurationSeconds(
  destination: string | null | undefined,
  tripType: StoredTravelTripType | null,
): number | null {
  if (!destination || !tripType) {
    return null;
  }

  const durationKey = tripType === "Business Class/Standard" ? "Business Class" : tripType;
  const minutes = TRAVEL_DURATIONS_MINUTES[destination]?.[durationKey];
  return minutes ? minutes * 60 : null;
}

function formatPlaneImageType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return (
    PLANE_IMAGE_TYPE_LABELS[value] ??
    value
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function buildTravelSignature(
  description: string | null,
  planeImageType: string | null,
  travel: ParsedTravel,
): string {
  return [
    description ?? "",
    planeImageType ?? "",
    travel.origin,
    travel.destination,
  ].join("|");
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

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

async function refreshMissingFfBattlestats(
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

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
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
  });

  if (!response.ok) {
    throw new Error(`FFScouter API error: ${response.status}`);
  }

  return extractFfBattlestatEstimates(await response.json());
}

async function fetchBspBattlestatPrediction(
  env: Env,
  memberId: number,
): Promise<number | null> {
  if (!env.BSP_TORN_API_KEY) {
    throw new Error("BSP_TORN_API_KEY is not configured");
  }

  const url = `${LOL_MANAGER_BATTLESTATS_API_BASE_URL}/${encodeURIComponent(env.BSP_TORN_API_KEY)}/${memberId}/9.4.2`;
  const response = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  });

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

function d1Changes(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" && Number.isFinite(changes) ? changes : 0;
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

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCOUTING_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
