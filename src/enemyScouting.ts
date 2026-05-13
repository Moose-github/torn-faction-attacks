import {
  FFSCOUTER_STATS_API_URL,
  HOME_FACTION_ID,
  LOL_MANAGER_BATTLESTATS_API_BASE_URL,
  TORN_FACTION_API_BASE_URL,
} from "./constants";
import { fetchTornPersonalStats } from "./personalStats";
import { Env, TornFactionMember, TornFactionMembersResponse, WarRow } from "./types";
import { boolToInt, json, nowSeconds } from "./utils";
import { isWarRoomMemberTrackingActive } from "./warRoomTracking";

const FFSCOUTER_BATCH_SIZE = 100;
const SCOUTING_FETCH_TIMEOUT_MS = 15000;
const BSP_BATTLESTAT_REFRESH_LIMIT = 40;
const NETWORTH_REFRESH_LIMIT = 40;
const TORN_LOCATION = "Torn";
const ENEMY_TRAVEL_CLEAR_STATE_PREFIX = "enemy_travel_cleared";

type TravelDurationKey = "Standard" | "Airstrip" | "WLT benefit" | "Business Class";

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
};

type MemberTravelStatus = {
  status_state: string | null;
  status_description: string | null;
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
  status_updated_at: number | null;
};

type EnemyMemberSnapshot = MemberTravelStatus & {
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
  enemy_faction_id: number;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  enemy_scouting_status_checked_at: number | null;
};

export type EnemyTravelRefreshMetrics = {
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
  const [homeMembers, enemyMembers] = await Promise.all([
    readHomeScouting(env),
    readEnemyScouting(env, enemyFactionId),
  ]);

  return json({
    ok: true,
    war: {
      id: war.id,
      name: war.name,
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

export async function refreshEnemyScoutingForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromScoutingUrl(url, env);
  if (war instanceof Response) {
    return war;
  }

  const enemyFactionId = war.enemy_faction_id as number;
  const existing = await readEnemyScouting(env, enemyFactionId);
  let refreshed = false;

  if (existing.length === 0) {
    refreshed = await replaceEnemyFactionMembers(env, enemyFactionId);
    if (refreshed) {
      await markEnemyScoutingStatusChecked(env, war.id, nowSeconds());
    }
  } else {
    await refreshEnemyFactionMemberStatuses(
      env,
      war.id,
      enemyFactionId,
      war.enemy_scouting_status_checked_at,
    );
    const refreshedRows = await readEnemyScouting(env, enemyFactionId);
    await refreshMissingFfBattlestats(env, refreshedRows);
    await refreshMissingBspBattlestatPredictionsForFaction(env, "enemy_faction_members", enemyFactionId, refreshedRows);
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
    const enemyRefreshed = await replaceEnemyFactionMembers(env, war.enemy_faction_id);
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

export async function refreshCurrentEnemyTravelStatuses(
  env: Env,
  options: { includeMembers?: boolean } = {},
): Promise<EnemyTravelRefreshMetrics> {
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
  if (!isWarRoomMemberTrackingActive(war, checkedAt)) {
    const clearMetrics =
      war.practical_finish_time !== null && checkedAt > war.practical_finish_time
        ? await clearEnemyTravelTrackerData(env, war.id, war.enemy_faction_id)
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

async function readCurrentScoutingWar(env: Env): Promise<CurrentScoutingWar | null> {
  return (await env.DB.prepare(
    `
    SELECT
      id,
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

async function replaceEnemyFactionMembers(env: Env, factionId: number): Promise<boolean> {
  if (!(await canReplaceCachedEnemyScouting(env, factionId))) {
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
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM enemy_faction_members`),
    env.DB.prepare(
      `
      UPDATE home_faction_members
      SET ff_battlestats = NULL,
          ff_battlestats_updated_at = NULL,
          bsp_battlestats = NULL,
          bsp_battlestats_updated_at = NULL,
          updated_at = unixepoch()
      WHERE ff_battlestats IS NOT NULL
         OR ff_battlestats_updated_at IS NOT NULL
         OR bsp_battlestats IS NOT NULL
         OR bsp_battlestats_updated_at IS NOT NULL
      `,
    ),
    ...members.map((member) => {
      const travelStatus = buildMemberTravelStatus(member, null, null, fetchedAt);
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
          status_updated_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(member_id) DO UPDATE SET
          faction_id = excluded.faction_id,
          name = excluded.name,
          level = excluded.level,
          position = excluded.position,
          days_in_faction = excluded.days_in_faction,
          is_revivable = excluded.is_revivable,
          status_state = excluded.status_state,
          status_description = excluded.status_description,
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
        travelStatus.status_state,
        travelStatus.status_description,
        travelStatus.plane_image_type,
        travelStatus.travel_origin,
        travelStatus.travel_destination,
        travelStatus.travel_signature,
        travelStatus.travel_detected_at,
        travelStatus.travel_started_after,
        travelStatus.travel_started_before,
        travelStatus.estimated_arrival_at,
        travelStatus.estimated_arrival_earliest,
        travelStatus.estimated_arrival_latest,
        travelStatus.status_updated_at,
      );
    }),
  ]);

  const rows = await readEnemyScouting(env, factionId);
  await refreshMissingFfBattlestats(env, rows);
  await refreshMissingBspBattlestatPredictionsForFaction(env, "enemy_faction_members", factionId, rows);
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
       OR bsp_battlestats_updated_at IS NULL
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  await refreshMissingFfBattlestats(env, rows ?? [], "home_faction_members");
  await refreshMissingBspBattlestatPredictionsForFaction(
    env,
    "home_faction_members",
    HOME_FACTION_ID,
    rows ?? [],
  );
}

async function canReplaceCachedEnemyScouting(env: Env, nextFactionId: number): Promise<boolean> {
  const cachedFactions = ((await env.DB.prepare(
    `
    SELECT DISTINCT faction_id
    FROM enemy_faction_members
    WHERE faction_id != ?
    `,
  )
    .bind(nextFactionId)
    .all()).results ?? []) as { faction_id: number }[];

  for (const cachedFaction of cachedFactions) {
    const unfinishedWar = (await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE enemy_faction_id = ?
        AND official_end_time IS NULL
      ORDER BY practical_start_time DESC
      LIMIT 1
      `,
    )
      .bind(cachedFaction.faction_id)
      .first()) as { id: number } | null;

    if (unfinishedWar) {
      return false;
    }
  }

  return true;
}

async function refreshEnemyFactionMemberStatuses(
  env: Env,
  warId: number,
  factionId: number,
  previousPollAt: number | null,
  options: { members?: TornFactionMember[]; includeMembers?: boolean } = {},
): Promise<EnemyTravelRefreshMetrics> {
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

  for (const member of members) {
    const existing = existingById.get(member.id) ?? null;
    const next = buildEnemyMemberSnapshot(member, factionId, existing, previousPollAt, fetchedAt);
    if (!existing || enemyMemberSnapshotChanged(existing, next)) {
      statements.push(upsertEnemyMemberSnapshot(env, next));
    }
  }

  let changedRows = 0;
  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    changedRows = results.reduce((total: number, result: unknown) => total + d1Changes(result), 0);
  }

  await markEnemyScoutingStatusChecked(env, warId, fetchedAt);

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
      status_updated_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(member_id) DO UPDATE SET
      faction_id = excluded.faction_id,
      name = excluded.name,
      level = excluded.level,
      position = excluded.position,
      days_in_faction = excluded.days_in_faction,
      is_revivable = excluded.is_revivable,
      status_state = excluded.status_state,
      status_description = excluded.status_description,
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
    snapshot.status_updated_at,
  );
}

async function clearEnemyTravelTrackerData(
  env: Env,
  warId: number,
  factionId: number,
): Promise<{ writeStatements: number; changedRows: number }> {
  const stateName = `${ENEMY_TRAVEL_CLEAR_STATE_PREFIX}:${warId}`;
  const existingClear = await env.DB.prepare(
    `
    SELECT last_started
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(stateName)
    .first();

  if (existingClear) {
    return { writeStatements: 0, changedRows: 0 };
  }

  const result = await env.DB.prepare(
    `
    UPDATE enemy_faction_members
    SET status_state = NULL,
        status_description = NULL,
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
        status_updated_at = NULL,
        updated_at = unixepoch()
    WHERE faction_id = ?
      AND (
        status_state IS NOT NULL OR
        status_description IS NOT NULL OR
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
        status_updated_at IS NOT NULL
      )
    `,
  )
    .bind(factionId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id)
    VALUES (?, unixepoch(), ?)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      active_war_id = excluded.active_war_id,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(stateName, warId)
    .run();

  return {
    writeStatements: 2,
    changedRows: d1Changes(result) + 1,
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
    ...buildMemberTravelStatus(member, previous, previousPollAt, fetchedAt),
  };
}

function buildMemberTravelStatus(
  member: TornFactionMember,
  previous: EnemyFactionMemberRow | null,
  previousPollAt: number | null,
  fetchedAt: number,
): MemberTravelStatus {
  const statusState = cleanText(member.status?.state);
  const statusDescription = cleanText(member.status?.description);
  const planeImageType = cleanText(member.status?.plane_image_type);
  const parsedTravel = parseTravelDescription(statusDescription);
  const isTraveling = statusState === "Traveling" && parsedTravel !== null;
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
    return {
      status_state: statusState,
      status_description: statusDescription,
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
      status_updated_at: statusChanged ? fetchedAt : (previous?.status_updated_at ?? fetchedAt),
    };
  }

  if (!isNewTrip && previous) {
    const estimate =
      planeImageType === "airliner"
        ? estimateTravelArrival(
            parsedTravel.flightLocation,
            planeImageType,
            previous.travel_started_after ?? null,
            previous.travel_started_before ?? fetchedAt,
          )
        : {
            estimated_arrival_at: previous.estimated_arrival_at ?? null,
            estimated_arrival_earliest: previous.estimated_arrival_earliest ?? null,
            estimated_arrival_latest: previous.estimated_arrival_latest ?? null,
          };

    return {
      status_state: statusState,
      status_description: statusDescription,
      plane_image_type: planeImageType,
      travel_origin: parsedTravel.origin,
      travel_destination: parsedTravel.destination,
      travel_signature: travelSignature,
      travel_detected_at: previous.travel_detected_at ?? null,
      travel_started_after: previous.travel_started_after ?? null,
      travel_started_before: previous.travel_started_before ?? null,
      ...estimate,
      status_updated_at: statusChanged ? fetchedAt : (previous.status_updated_at ?? fetchedAt),
    };
  }

  const startedAfter = previousPollAt ?? previous?.status_updated_at ?? null;
  const startedBefore = fetchedAt;
  const estimate = estimateTravelArrival(
    parsedTravel.flightLocation,
    planeImageType,
    startedAfter,
    startedBefore,
  );

  return {
    status_state: statusState,
    status_description: statusDescription,
    plane_image_type: planeImageType,
    travel_origin: parsedTravel.origin,
    travel_destination: parsedTravel.destination,
    travel_signature: travelSignature,
    travel_detected_at: fetchedAt,
    travel_started_after: startedAfter,
    travel_started_before: startedBefore,
    ...estimate,
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

function estimateTravelArrival(
  flightLocation: string,
  planeImageType: string | null,
  startedAfter: number | null,
  startedBefore: number,
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

  if (row.plane_image_type === "airliner") {
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
    };
  }

  const durationKey = row.plane_image_type
    ? PLANE_IMAGE_TYPE_TO_DURATION_KEY[row.plane_image_type]
    : undefined;
  const travelType = durationKey ?? null;

  return {
    plane_type_label: planeTypeLabel,
    travel_type: travelType,
    travel_type_note: planeTypeLabel,
    travel_time_note: travelType ?? planeTypeLabel,
    arrival_note: row.status_description ?? "Travel arrival estimate",
    is_travel_time_range: false,
  };
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
  const result = Number.isFinite(Number(data?.Result)) ? Number(data.Result) : null;
  if (result === 0 || result === 6) {
    return null;
  }

  return finiteNumber(data?.TBS);
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
