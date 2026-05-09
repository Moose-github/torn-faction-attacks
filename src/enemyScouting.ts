import { FFSCOUTER_STATS_API_URL, HOME_FACTION_ID, TORN_FACTION_API_BASE_URL } from "./constants";
import { fetchTornPersonalStats } from "./personalStats";
import { Env, TornFactionMember, TornFactionMembersResponse, WarRow } from "./types";
import { boolToInt, json, nowSeconds } from "./utils";

const FFSCOUTER_BATCH_SIZE = 100;
const SCOUTING_FETCH_TIMEOUT_MS = 15000;
const NETWORTH_REFRESH_LIMIT = 40;
const TORN_LOCATION = "Torn";

type TravelDurationKey = "standard" | "light_aircraft" | "wlt_benefit" | "airliner";

const TRAVEL_DURATIONS_MINUTES: Record<string, Record<TravelDurationKey, number>> = {
  Mexico: { standard: 26, light_aircraft: 18, wlt_benefit: 13, airliner: 8 },
  "Cayman Islands": { standard: 35, light_aircraft: 25, wlt_benefit: 18, airliner: 11 },
  Canada: { standard: 41, light_aircraft: 29, wlt_benefit: 20, airliner: 12 },
  Hawaii: { standard: 134, light_aircraft: 94, wlt_benefit: 67, airliner: 40 },
  "United Kingdom": { standard: 159, light_aircraft: 111, wlt_benefit: 80, airliner: 48 },
  Argentina: { standard: 167, light_aircraft: 117, wlt_benefit: 83, airliner: 50 },
  Switzerland: { standard: 175, light_aircraft: 123, wlt_benefit: 88, airliner: 53 },
  Japan: { standard: 225, light_aircraft: 158, wlt_benefit: 113, airliner: 68 },
  China: { standard: 242, light_aircraft: 169, wlt_benefit: 121, airliner: 72 },
  "United Arab Emirates": { standard: 271, light_aircraft: 190, wlt_benefit: 135, airliner: 81 },
  "South Africa": { standard: 297, light_aircraft: 208, wlt_benefit: 149, airliner: 89 },
};

const PLANE_IMAGE_TYPE_TO_DURATION_KEY: Record<string, TravelDurationKey> = {
  light_aircraft: "light_aircraft",
  airliner: "airliner",
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
  uae: "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  "united kingdom": "United Kingdom",
  uk: "United Kingdom",
};

type EnemyFactionMemberRow = {
  member_id: number;
  faction_id: number;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number | null;
  estimated_stats: number | null;
  estimated_stats_updated_at: number | null;
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

type StatEstimate = {
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
  enemy_scouting_status_checked_at: number | null;
};

export type EnemyTravelRefreshMetrics = {
  writeStatements: number;
  changedRows: number;
  fetchedMembers: number;
  updatedMembers: number;
  skipped: boolean;
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
    await refreshMissingStatEstimates(env, await readEnemyScouting(env, enemyFactionId));
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
): Promise<EnemyTravelRefreshMetrics> {
  const war = await readCurrentScoutingWar(env);
  if (!war) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
    };
  }

  return refreshEnemyFactionMemberStatuses(
    env,
    war.id,
    war.enemy_faction_id,
    war.enemy_scouting_status_checked_at,
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
      AND estimated_stats IS NULL
    ORDER BY level DESC, name ASC
    `,
  )
    .bind(scoutingWar.enemy_faction_id)
    .all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.enemyCandidates = enemyRows?.length ?? 0;
  const enemyMetrics = await refreshMissingStatEstimates(env, enemyRows ?? []);
  metrics.writeStatements += enemyMetrics.writeStatements;
  metrics.changedRows += enemyMetrics.changedRows;
  metrics.enemyUpdated += enemyMetrics.changedRows;

  const homeRows = (await env.DB.prepare(
    `
    SELECT *
    FROM home_faction_members
    WHERE estimated_stats IS NULL
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  metrics.homeCandidates = homeRows?.length ?? 0;
  const homeMetrics = await refreshMissingStatEstimates(env, homeRows ?? [], "home_faction_members");
  metrics.writeStatements += homeMetrics.writeStatements;
  metrics.changedRows += homeMetrics.changedRows;
  metrics.homeUpdated += homeMetrics.changedRows;

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
    SELECT id, enemy_faction_id, enemy_scouting_status_checked_at
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
    ORDER BY estimated_stats DESC NULLS LAST, level DESC, name ASC
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
    ORDER BY estimated_stats DESC NULLS LAST, level DESC, name ASC
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
  await refreshMissingStatEstimates(env, rows);
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
    WHERE estimated_stats IS NULL
    ORDER BY level DESC, name ASC
    `,
  ).all()).results as EnemyFactionMemberRow[] | undefined;

  await refreshMissingStatEstimates(env, rows ?? [], "home_faction_members");
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
): Promise<EnemyTravelRefreshMetrics> {
  const fetchedAt = nowSeconds();
  const members = await fetchTornFactionMembers(env, factionId);

  if (members.length === 0) {
    return {
      writeStatements: 0,
      changedRows: 0,
      fetchedMembers: 0,
      updatedMembers: 0,
      skipped: true,
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
      estimated_arrival_at: previous.estimated_arrival_at ?? null,
      estimated_arrival_earliest: previous.estimated_arrival_earliest ?? null,
      estimated_arrival_latest: previous.estimated_arrival_latest ?? null,
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

async function refreshMissingStatEstimates(
  env: Env,
  rows: EnemyFactionMemberRow[],
  tableName = "enemy_faction_members",
): Promise<{ writeStatements: number; changedRows: number }> {
  const metrics = { writeStatements: 0, changedRows: 0 };
  if (!env.FFSCOUTER_API_KEY) {
    return metrics;
  }

  const missingIds = rows
    .filter((row) => row.estimated_stats === null)
    .map((row) => row.member_id);

  for (const ids of chunks(missingIds, FFSCOUTER_BATCH_SIZE)) {
    const estimates = await fetchFfscouterStats(env, ids).catch((err) => {
      console.warn("FFScouter stats fetch failed:", err?.message || err);
      return new Map<number, StatEstimate>();
    });

    const statements = Array.from(estimates.entries()).map(([memberId, estimate]) =>
      env.DB.prepare(
        `
        UPDATE ${tableName}
        SET estimated_stats = ?,
            estimated_stats_updated_at = COALESCE(?, unixepoch()),
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
): Promise<Map<number, StatEstimate>> {
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

  return extractStatEstimates(await response.json());
}

function extractStatEstimates(data: any): Map<number, StatEstimate> {
  const estimates = new Map<number, StatEstimate>();
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

function addEstimate(estimates: Map<number, StatEstimate>, idValue: unknown, source: any) {
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
          source.estimated_stats,
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
  const statsRows = rows.filter((row) => row.estimated_stats !== null);
  const networthRows = rows.filter((row) => row.networth !== null);
  const travelingRows = rows.filter((row) => row.status_state === "Traveling");
  const averageLevel =
    rows.length === 0
      ? 0
      : rows.reduce((total, row) => total + Number(row.level ?? 0), 0) / rows.length;
  const averageEstimatedStats =
    statsRows.length === 0
      ? null
      : statsRows.reduce((total, row) => total + Number(row.estimated_stats ?? 0), 0) /
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
      average_estimated_stats: averageEstimatedStats,
      missing_estimated_stats: rows.length - statsRows.length,
      stats_available: statsRows.length,
      networth_available: networthRows.length,
      traveling: travelingRows.length,
      status_checked_at: war.enemy_scouting_status_checked_at,
    },
    members: rows,
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
