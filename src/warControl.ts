import { readJsonObject } from "./backend/request";
import { HOME_FACTION_ID } from "./constants";
import { readWarFromUrl } from "./warRequest";
import { Env, TornFactionMember, WarRow } from "./types";
import { finiteNumber, json } from "./utils";

const CONTROL_BUCKET_SECONDS = 60;
const RECENT_ACTIVITY_WINDOW_SECONDS = 5 * 60;
const HISTORY_LIMIT = 96;

export type WarControlState =
  | "opening"
  | "home_control"
  | "enemy_control"
  | "contested"
  | "transitioning"
  | "unknown";

export type WarControlSettings = {
  id: 1;
  control_hospital_threshold: number;
  available_advantage_min: number;
  opening_grace_minutes: number;
  status_freshness_max_seconds: number;
  min_observed_roster_percent: number;
  min_local_relevant_members: number;
  heavy_own_hospital_penalty_threshold: number;
  severe_own_hospital_penalty_threshold: number;
  heavy_own_hospital_confidence_penalty: number;
  severe_own_hospital_confidence_penalty: number;
  transition_hospital_ratio_drop: number;
  transition_window_minutes: number;
  transition_min_attacks_5m: number;
  transition_big_hitter_multiplier_one: number;
  transition_big_hitter_multiplier_multiple: number;
  updated_at: number;
};

export type WarControlSnapshot = {
  war_id: number;
  bucket_start: number;
  home_total_members: number;
  home_observed_members: number;
  home_observed_roster_percent: number;
  home_available_count: number;
  home_hospital_count: number;
  home_travel_count: number;
  home_unknown_count: number;
  home_local_relevant_count: number;
  enemy_total_members: number;
  enemy_observed_members: number;
  enemy_observed_roster_percent: number;
  enemy_available_count: number;
  enemy_hospital_count: number;
  enemy_travel_count: number;
  enemy_unknown_count: number;
  enemy_local_relevant_count: number;
  home_attacks_last_5m: number;
  enemy_attacks_last_5m: number;
  home_attacks_last_15m: number;
  enemy_attacks_last_15m: number;
  enemy_big_hitter_total_count: number;
  enemy_big_hitter_available_count: number;
  enemy_big_hitter_hospital_count: number;
  enemy_big_hitter_travel_count: number;
  enemy_big_hitter_recently_active_count: number;
  home_hospital_ratio: number;
  enemy_hospital_ratio: number;
  home_available_ratio: number;
  enemy_available_ratio: number;
  home_status_age_seconds: number;
  enemy_status_age_seconds: number;
  control_state: WarControlState;
  control_confidence: number;
  control_reason: string;
  reasons_json: string;
  created_at: number;
};

type SideCounts = {
  total: number;
  observed: number;
  observedPercent: number;
  available: number;
  hospital: number;
  travel: number;
  unknown: number;
  localRelevant: number;
  hospitalRatio: number;
  availableRatio: number;
};

export const DEFAULT_WAR_CONTROL_SETTINGS: WarControlSettings = {
  id: 1,
  control_hospital_threshold: 0.8,
  available_advantage_min: 0.15,
  opening_grace_minutes: 15,
  status_freshness_max_seconds: 180,
  min_observed_roster_percent: 0.6,
  min_local_relevant_members: 10,
  heavy_own_hospital_penalty_threshold: 0.6,
  severe_own_hospital_penalty_threshold: 0.75,
  heavy_own_hospital_confidence_penalty: 0.1,
  severe_own_hospital_confidence_penalty: 0.2,
  transition_hospital_ratio_drop: 0.2,
  transition_window_minutes: 5,
  transition_min_attacks_5m: 3,
  transition_big_hitter_multiplier_one: 1.1,
  transition_big_hitter_multiplier_multiple: 1.25,
  updated_at: 0,
};

export async function readWarControlSettings(env: Env): Promise<WarControlSettings> {
  const row = await env.DB.prepare(
    `
    SELECT *
    FROM war_control_settings
    WHERE id = 1
    LIMIT 1
    `,
  ).first<WarControlSettings>();

  return normalizeWarControlSettings(row);
}

export async function updateWarControlSettingsFromRequest(request: Request, env: Env): Promise<Response> {
  const current = await readWarControlSettings(env);
  const body = await readJsonObject(request);
  const next = normalizeWarControlSettings({
    ...current,
    ...body,
    id: 1,
  });

  await env.DB.prepare(
    `
    INSERT INTO war_control_settings (
      id,
      control_hospital_threshold,
      available_advantage_min,
      opening_grace_minutes,
      status_freshness_max_seconds,
      min_observed_roster_percent,
      min_local_relevant_members,
      heavy_own_hospital_penalty_threshold,
      severe_own_hospital_penalty_threshold,
      heavy_own_hospital_confidence_penalty,
      severe_own_hospital_confidence_penalty,
      transition_hospital_ratio_drop,
      transition_window_minutes,
      transition_min_attacks_5m,
      transition_big_hitter_multiplier_one,
      transition_big_hitter_multiplier_multiple,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(id) DO UPDATE SET
      control_hospital_threshold = excluded.control_hospital_threshold,
      available_advantage_min = excluded.available_advantage_min,
      opening_grace_minutes = excluded.opening_grace_minutes,
      status_freshness_max_seconds = excluded.status_freshness_max_seconds,
      min_observed_roster_percent = excluded.min_observed_roster_percent,
      min_local_relevant_members = excluded.min_local_relevant_members,
      heavy_own_hospital_penalty_threshold = excluded.heavy_own_hospital_penalty_threshold,
      severe_own_hospital_penalty_threshold = excluded.severe_own_hospital_penalty_threshold,
      heavy_own_hospital_confidence_penalty = excluded.heavy_own_hospital_confidence_penalty,
      severe_own_hospital_confidence_penalty = excluded.severe_own_hospital_confidence_penalty,
      transition_hospital_ratio_drop = excluded.transition_hospital_ratio_drop,
      transition_window_minutes = excluded.transition_window_minutes,
      transition_min_attacks_5m = excluded.transition_min_attacks_5m,
      transition_big_hitter_multiplier_one = excluded.transition_big_hitter_multiplier_one,
      transition_big_hitter_multiplier_multiple = excluded.transition_big_hitter_multiplier_multiple,
      updated_at = excluded.updated_at
    `,
  )
    .bind(
      1,
      next.control_hospital_threshold,
      next.available_advantage_min,
      next.opening_grace_minutes,
      next.status_freshness_max_seconds,
      next.min_observed_roster_percent,
      next.min_local_relevant_members,
      next.heavy_own_hospital_penalty_threshold,
      next.severe_own_hospital_penalty_threshold,
      next.heavy_own_hospital_confidence_penalty,
      next.severe_own_hospital_confidence_penalty,
      next.transition_hospital_ratio_drop,
      next.transition_window_minutes,
      next.transition_min_attacks_5m,
      next.transition_big_hitter_multiplier_one,
      next.transition_big_hitter_multiplier_multiple,
    )
    .run();

  return json({ ok: true, settings: await readWarControlSettings(env) });
}

export async function getWarControlSettings(env: Env): Promise<Response> {
  return json({ ok: true, settings: await readWarControlSettings(env) });
}

export async function getWarControlForWar(url: URL, env: Env): Promise<Response> {
  const war = await readWarFromUrl<WarRow>(url, env, { requireEnemyFaction: true });
  if (war instanceof Response) {
    return war;
  }

  const includeHistory = url.searchParams.get("include_history") !== "0";
  const settings = await readWarControlSettings(env);
  const latest = await readLatestWarControlSnapshot(env, war.id);
  const history = includeHistory ? await readWarControlHistory(env, war.id) : [];

  return json({
    ok: true,
    war: {
      id: war.id,
      name: war.name,
      status: war.status,
      practical_start_time: war.practical_start_time,
      practical_finish_time: war.practical_finish_time,
      enemy_faction_id: war.enemy_faction_id,
    },
    settings,
    latest: parseSnapshotReasons(latest),
    history: history.map(parseSnapshotReasons),
  });
}

export async function buildWarControlSnapshot(
  env: Env,
  war: {
    id: number;
    practical_start_time: number;
    enemy_faction_id: number;
  },
  homeMembers: TornFactionMember[],
  enemyMembers: TornFactionMember[],
  sampledAt: number,
): Promise<WarControlSnapshot> {
  const settings = await readWarControlSettings(env);
  const bucketStart = Math.floor(sampledAt / CONTROL_BUCKET_SECONDS) * CONTROL_BUCKET_SECONDS;
  const [
    homeAttacks5m,
    enemyAttacks5m,
    homeAttacks15m,
    enemyAttacks15m,
    bigHitterIds,
    previous,
  ] = await Promise.all([
    readAttackCount(env, war.id, HOME_FACTION_ID, war.enemy_faction_id, sampledAt, 5 * 60),
    readAttackCount(env, war.id, war.enemy_faction_id, HOME_FACTION_ID, sampledAt, 5 * 60),
    readAttackCount(env, war.id, HOME_FACTION_ID, war.enemy_faction_id, sampledAt, 15 * 60),
    readAttackCount(env, war.id, war.enemy_faction_id, HOME_FACTION_ID, sampledAt, 15 * 60),
    readEnemyBigHitterIds(env, war.id),
    readPreviousWarControlSnapshot(env, war.id, bucketStart, settings.transition_window_minutes),
  ]);

  const home = classifySide(homeMembers);
  const enemy = classifySide(enemyMembers);
  const bigHitters = classifyEnemyBigHitters(enemyMembers, new Set(bigHitterIds), sampledAt);
  const decision = decideControlState({
    warStartedAt: war.practical_start_time,
    sampledAt,
    home,
    enemy,
    homeAttacks5m,
    enemyAttacks5m,
    bigHitters,
    previous,
    settings,
  });

  return {
    war_id: war.id,
    bucket_start: bucketStart,
    home_total_members: home.total,
    home_observed_members: home.observed,
    home_observed_roster_percent: home.observedPercent,
    home_available_count: home.available,
    home_hospital_count: home.hospital,
    home_travel_count: home.travel,
    home_unknown_count: home.unknown,
    home_local_relevant_count: home.localRelevant,
    enemy_total_members: enemy.total,
    enemy_observed_members: enemy.observed,
    enemy_observed_roster_percent: enemy.observedPercent,
    enemy_available_count: enemy.available,
    enemy_hospital_count: enemy.hospital,
    enemy_travel_count: enemy.travel,
    enemy_unknown_count: enemy.unknown,
    enemy_local_relevant_count: enemy.localRelevant,
    home_attacks_last_5m: homeAttacks5m,
    enemy_attacks_last_5m: enemyAttacks5m,
    home_attacks_last_15m: homeAttacks15m,
    enemy_attacks_last_15m: enemyAttacks15m,
    enemy_big_hitter_total_count: bigHitters.total,
    enemy_big_hitter_available_count: bigHitters.available,
    enemy_big_hitter_hospital_count: bigHitters.hospital,
    enemy_big_hitter_travel_count: bigHitters.travel,
    enemy_big_hitter_recently_active_count: bigHitters.recentlyActive,
    home_hospital_ratio: home.hospitalRatio,
    enemy_hospital_ratio: enemy.hospitalRatio,
    home_available_ratio: home.availableRatio,
    enemy_available_ratio: enemy.availableRatio,
    home_status_age_seconds: 0,
    enemy_status_age_seconds: 0,
    control_state: decision.state,
    control_confidence: decision.confidence,
    control_reason: decision.reason,
    reasons_json: JSON.stringify(decision.reasons),
    created_at: sampledAt,
  };
}

export function upsertWarControlSnapshot(env: Env, snapshot: WarControlSnapshot): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO war_control_snapshots (
      war_id,
      bucket_start,
      home_total_members,
      home_observed_members,
      home_observed_roster_percent,
      home_available_count,
      home_hospital_count,
      home_travel_count,
      home_unknown_count,
      home_local_relevant_count,
      enemy_total_members,
      enemy_observed_members,
      enemy_observed_roster_percent,
      enemy_available_count,
      enemy_hospital_count,
      enemy_travel_count,
      enemy_unknown_count,
      enemy_local_relevant_count,
      home_attacks_last_5m,
      enemy_attacks_last_5m,
      home_attacks_last_15m,
      enemy_attacks_last_15m,
      enemy_big_hitter_total_count,
      enemy_big_hitter_available_count,
      enemy_big_hitter_hospital_count,
      enemy_big_hitter_travel_count,
      enemy_big_hitter_recently_active_count,
      home_hospital_ratio,
      enemy_hospital_ratio,
      home_available_ratio,
      enemy_available_ratio,
      home_status_age_seconds,
      enemy_status_age_seconds,
      control_state,
      control_confidence,
      control_reason,
      reasons_json,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(war_id, bucket_start) DO UPDATE SET
      home_total_members = excluded.home_total_members,
      home_observed_members = excluded.home_observed_members,
      home_observed_roster_percent = excluded.home_observed_roster_percent,
      home_available_count = excluded.home_available_count,
      home_hospital_count = excluded.home_hospital_count,
      home_travel_count = excluded.home_travel_count,
      home_unknown_count = excluded.home_unknown_count,
      home_local_relevant_count = excluded.home_local_relevant_count,
      enemy_total_members = excluded.enemy_total_members,
      enemy_observed_members = excluded.enemy_observed_members,
      enemy_observed_roster_percent = excluded.enemy_observed_roster_percent,
      enemy_available_count = excluded.enemy_available_count,
      enemy_hospital_count = excluded.enemy_hospital_count,
      enemy_travel_count = excluded.enemy_travel_count,
      enemy_unknown_count = excluded.enemy_unknown_count,
      enemy_local_relevant_count = excluded.enemy_local_relevant_count,
      home_attacks_last_5m = excluded.home_attacks_last_5m,
      enemy_attacks_last_5m = excluded.enemy_attacks_last_5m,
      home_attacks_last_15m = excluded.home_attacks_last_15m,
      enemy_attacks_last_15m = excluded.enemy_attacks_last_15m,
      enemy_big_hitter_total_count = excluded.enemy_big_hitter_total_count,
      enemy_big_hitter_available_count = excluded.enemy_big_hitter_available_count,
      enemy_big_hitter_hospital_count = excluded.enemy_big_hitter_hospital_count,
      enemy_big_hitter_travel_count = excluded.enemy_big_hitter_travel_count,
      enemy_big_hitter_recently_active_count = excluded.enemy_big_hitter_recently_active_count,
      home_hospital_ratio = excluded.home_hospital_ratio,
      enemy_hospital_ratio = excluded.enemy_hospital_ratio,
      home_available_ratio = excluded.home_available_ratio,
      enemy_available_ratio = excluded.enemy_available_ratio,
      home_status_age_seconds = excluded.home_status_age_seconds,
      enemy_status_age_seconds = excluded.enemy_status_age_seconds,
      control_state = excluded.control_state,
      control_confidence = excluded.control_confidence,
      control_reason = excluded.control_reason,
      reasons_json = excluded.reasons_json,
      created_at = excluded.created_at
    `,
  ).bind(
    snapshot.war_id,
    snapshot.bucket_start,
    snapshot.home_total_members,
    snapshot.home_observed_members,
    snapshot.home_observed_roster_percent,
    snapshot.home_available_count,
    snapshot.home_hospital_count,
    snapshot.home_travel_count,
    snapshot.home_unknown_count,
    snapshot.home_local_relevant_count,
    snapshot.enemy_total_members,
    snapshot.enemy_observed_members,
    snapshot.enemy_observed_roster_percent,
    snapshot.enemy_available_count,
    snapshot.enemy_hospital_count,
    snapshot.enemy_travel_count,
    snapshot.enemy_unknown_count,
    snapshot.enemy_local_relevant_count,
    snapshot.home_attacks_last_5m,
    snapshot.enemy_attacks_last_5m,
    snapshot.home_attacks_last_15m,
    snapshot.enemy_attacks_last_15m,
    snapshot.enemy_big_hitter_total_count,
    snapshot.enemy_big_hitter_available_count,
    snapshot.enemy_big_hitter_hospital_count,
    snapshot.enemy_big_hitter_travel_count,
    snapshot.enemy_big_hitter_recently_active_count,
    snapshot.home_hospital_ratio,
    snapshot.enemy_hospital_ratio,
    snapshot.home_available_ratio,
    snapshot.enemy_available_ratio,
    snapshot.home_status_age_seconds,
    snapshot.enemy_status_age_seconds,
    snapshot.control_state,
    snapshot.control_confidence,
    snapshot.control_reason,
    snapshot.reasons_json,
    snapshot.created_at,
  );
}

function decideControlState(values: {
  warStartedAt: number;
  sampledAt: number;
  home: SideCounts;
  enemy: SideCounts;
  homeAttacks5m: number;
  enemyAttacks5m: number;
  bigHitters: ReturnType<typeof classifyEnemyBigHitters>;
  previous: WarControlSnapshot | null;
  settings: WarControlSettings;
}): { state: WarControlState; confidence: number; reason: string; reasons: string[] } {
  const { home, enemy, settings } = values;
  const reasons: string[] = [];
  const warAgeSeconds = Math.max(0, values.sampledAt - values.warStartedAt);

  if (warAgeSeconds < settings.opening_grace_minutes * 60) {
    reasons.push(`Opening grace period: ${Math.ceil((settings.opening_grace_minutes * 60 - warAgeSeconds) / 60)}m remaining`);
    return decision("opening", 0.35, "Opening momentum", reasons);
  }

  const dataIssue = firstDataQualityIssue(home, enemy, settings);
  if (dataIssue) {
    reasons.push(dataIssue);
    return decision("unknown", 0.1, "Not enough fresh status data", reasons);
  }

  const homeAvailableEdge = home.availableRatio - enemy.availableRatio;
  const enemyAvailableEdge = enemy.availableRatio - home.availableRatio;
  const homeControl =
    enemy.hospitalRatio >= settings.control_hospital_threshold &&
    homeAvailableEdge >= settings.available_advantage_min;
  const enemyControl =
    home.hospitalRatio >= settings.control_hospital_threshold &&
    enemyAvailableEdge >= settings.available_advantage_min;
  const transition = transitionState(values);

  if (transition) {
    reasons.push(transition.reason);
    return decision(
      "transitioning",
      transitionConfidence(transition.baseConfidence, values.bigHitters, settings),
      transition.label,
      reasons,
    );
  }

  if (homeControl && !enemyControl) {
    reasons.push(`${percent(enemy.hospitalRatio)} enemy local hospital >= ${percent(settings.control_hospital_threshold)} threshold`);
    reasons.push(`${signedPercent(homeAvailableEdge)} home available edge >= ${percent(settings.available_advantage_min)} threshold`);
    return decision(
      "home_control",
      controlConfidence("home", values),
      "Likely home control",
      reasons,
    );
  }

  if (enemyControl && !homeControl) {
    reasons.push(`${percent(home.hospitalRatio)} home local hospital >= ${percent(settings.control_hospital_threshold)} threshold`);
    reasons.push(`${signedPercent(enemyAvailableEdge)} enemy available edge >= ${percent(settings.available_advantage_min)} threshold`);
    return decision(
      "enemy_control",
      controlConfidence("enemy", values),
      "Likely enemy control",
      reasons,
    );
  }

  reasons.push(`Neither side has both ${percent(settings.control_hospital_threshold)} opposing hospital pressure and ${percent(settings.available_advantage_min)} available edge`);
  return decision("contested", contestedConfidence(values), "Contested", reasons);
}

function transitionState(values: {
  home: SideCounts;
  enemy: SideCounts;
  homeAttacks5m: number;
  enemyAttacks5m: number;
  previous: WarControlSnapshot | null;
  settings: WarControlSettings;
}): { label: string; reason: string; baseConfidence: number } | null {
  const previous = values.previous;
  if (!previous) {
    return null;
  }

  if (
    previous.control_state === "home_control" &&
    previous.enemy_hospital_ratio - values.enemy.hospitalRatio >= values.settings.transition_hospital_ratio_drop &&
    values.enemyAttacks5m >= values.settings.transition_min_attacks_5m
  ) {
    return {
      label: "Enemy control swing risk",
      reason: `Enemy hospital ratio dropped ${signedPercent(values.enemy.hospitalRatio - previous.enemy_hospital_ratio)} with ${values.enemyAttacks5m} enemy attacks in 5m`,
      baseConfidence: 0.55 + Math.min(0.25, previous.enemy_hospital_ratio - values.enemy.hospitalRatio),
    };
  }

  if (
    previous.control_state === "enemy_control" &&
    previous.home_hospital_ratio - values.home.hospitalRatio >= values.settings.transition_hospital_ratio_drop &&
    values.homeAttacks5m >= values.settings.transition_min_attacks_5m
  ) {
    return {
      label: "Home control swing risk",
      reason: `Home hospital ratio dropped ${signedPercent(values.home.hospitalRatio - previous.home_hospital_ratio)} with ${values.homeAttacks5m} home attacks in 5m`,
      baseConfidence: 0.55 + Math.min(0.25, previous.home_hospital_ratio - values.home.hospitalRatio),
    };
  }

  return null;
}

function firstDataQualityIssue(
  home: SideCounts,
  enemy: SideCounts,
  settings: WarControlSettings,
): string | null {
  if (home.observedPercent < settings.min_observed_roster_percent) {
    return `Home observed roster ${percent(home.observedPercent)} below ${percent(settings.min_observed_roster_percent)} minimum`;
  }
  if (enemy.observedPercent < settings.min_observed_roster_percent) {
    return `Enemy observed roster ${percent(enemy.observedPercent)} below ${percent(settings.min_observed_roster_percent)} minimum`;
  }
  if (home.localRelevant < settings.min_local_relevant_members) {
    return `Home local relevant members ${home.localRelevant} below ${settings.min_local_relevant_members} minimum`;
  }
  if (enemy.localRelevant < settings.min_local_relevant_members) {
    return `Enemy local relevant members ${enemy.localRelevant} below ${settings.min_local_relevant_members} minimum`;
  }
  return null;
}

function controlConfidence(
  side: "home" | "enemy",
  values: {
    home: SideCounts;
    enemy: SideCounts;
    homeAttacks5m: number;
    enemyAttacks5m: number;
    bigHitters: ReturnType<typeof classifyEnemyBigHitters>;
    settings: WarControlSettings;
  },
): number {
  const own = side === "home" ? values.home : values.enemy;
  const opposing = side === "home" ? values.enemy : values.home;
  const availableEdge = own.availableRatio - opposing.availableRatio;
  let confidence = 0.45;
  confidence += Math.min(0.25, opposing.hospitalRatio - values.settings.control_hospital_threshold);
  confidence += Math.min(0.15, Math.max(0, availableEdge - values.settings.available_advantage_min));
  if (side === "home" && values.homeAttacks5m > values.enemyAttacks5m) {
    confidence += 0.1;
  }
  if (side === "enemy" && values.enemyAttacks5m > values.homeAttacks5m) {
    confidence += 0.1;
  }
  if (side === "home" && values.bigHitters.hospital + values.bigHitters.travel >= 2) {
    confidence += 0.05;
  }
  if (side === "enemy" && values.bigHitters.available + values.bigHitters.recentlyActive >= 2) {
    confidence += 0.05;
  }
  if (own.hospitalRatio >= values.settings.severe_own_hospital_penalty_threshold) {
    confidence -= values.settings.severe_own_hospital_confidence_penalty;
  } else if (own.hospitalRatio >= values.settings.heavy_own_hospital_penalty_threshold) {
    confidence -= values.settings.heavy_own_hospital_confidence_penalty;
  }
  return clampConfidence(confidence);
}

function contestedConfidence(values: {
  home: SideCounts;
  enemy: SideCounts;
  homeAttacks5m: number;
  enemyAttacks5m: number;
}): number {
  const ratioGap = Math.abs(values.home.hospitalRatio - values.enemy.hospitalRatio);
  const attackGap = Math.abs(values.homeAttacks5m - values.enemyAttacks5m);
  return clampConfidence(0.5 - Math.min(0.2, ratioGap) + Math.min(0.1, attackGap * 0.02));
}

function transitionConfidence(
  baseConfidence: number,
  bigHitters: ReturnType<typeof classifyEnemyBigHitters>,
  settings: WarControlSettings,
): number {
  const multiplier = bigHitters.recentlyActive <= 0
    ? 1
    : bigHitters.recentlyActive === 1
      ? settings.transition_big_hitter_multiplier_one
      : settings.transition_big_hitter_multiplier_multiple;
  return clampConfidence(baseConfidence * multiplier);
}

function classifySide(members: TornFactionMember[]): SideCounts {
  let observed = 0;
  let available = 0;
  let hospital = 0;
  let travel = 0;
  let unknown = 0;

  for (const member of members) {
    const classification = memberAvailability(member);
    if (classification === "unknown") {
      unknown += 1;
      continue;
    }
    observed += 1;
    if (classification === "hospital") {
      hospital += 1;
    } else if (classification === "travel") {
      travel += 1;
    } else {
      available += 1;
    }
  }

  const localRelevant = available + hospital;
  return {
    total: members.length,
    observed,
    observedPercent: ratio(observed, members.length),
    available,
    hospital,
    travel,
    unknown,
    localRelevant,
    hospitalRatio: ratio(hospital, localRelevant),
    availableRatio: ratio(available, localRelevant),
  };
}

function classifyEnemyBigHitters(
  members: TornFactionMember[],
  bigHitterIds: Set<number>,
  sampledAt: number,
): {
  total: number;
  available: number;
  hospital: number;
  travel: number;
  recentlyActive: number;
} {
  let available = 0;
  let hospital = 0;
  let travel = 0;
  let recentlyActive = 0;

  for (const member of members) {
    if (!bigHitterIds.has(member.id)) {
      continue;
    }
    const classification = memberAvailability(member);
    if (classification === "available") {
      available += 1;
    } else if (classification === "hospital") {
      hospital += 1;
    } else if (classification === "travel") {
      travel += 1;
    }
    const timestamp = finiteNumber(member.last_action?.timestamp);
    if (timestamp !== null && sampledAt - timestamp <= RECENT_ACTIVITY_WINDOW_SECONDS) {
      recentlyActive += 1;
    }
  }

  return {
    total: bigHitterIds.size,
    available,
    hospital,
    travel,
    recentlyActive,
  };
}

function memberAvailability(member: TornFactionMember): "available" | "hospital" | "travel" | "unknown" {
  const state = typeof member.status?.state === "string" ? member.status.state.trim().toLowerCase() : "";
  if (!state) {
    return "unknown";
  }
  if (state === "hospital") {
    return "hospital";
  }
  if (state === "traveling" || state === "abroad") {
    return "travel";
  }
  return "available";
}

async function readAttackCount(
  env: Env,
  warId: number,
  attackerFactionId: number,
  defenderFactionId: number,
  now: number,
  windowSeconds: number,
): Promise<number> {
  const row = await env.DB.prepare(
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
    .bind(warId, attackerFactionId, defenderFactionId, now - windowSeconds, now)
    .first<{ attacks: number | null }>();

  return Math.max(0, Math.floor(Number(row?.attacks ?? 0)));
}

async function readEnemyBigHitterIds(env: Env, warId: number): Promise<number[]> {
  const rows = await env.DB.prepare(
    `
    SELECT member_id
    FROM enemy_big_hitters
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .all<{ member_id: number }>();

  return (rows.results ?? [])
    .map((row) => Math.floor(Number(row.member_id)))
    .filter((memberId) => Number.isInteger(memberId) && memberId > 0);
}

async function readLatestWarControlSnapshot(env: Env, warId: number): Promise<WarControlSnapshot | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM war_control_snapshots
    WHERE war_id = ?
    ORDER BY bucket_start DESC
    LIMIT 1
    `,
  )
    .bind(warId)
    .first<WarControlSnapshot>();
}

async function readPreviousWarControlSnapshot(
  env: Env,
  warId: number,
  bucketStart: number,
  transitionWindowMinutes: number,
): Promise<WarControlSnapshot | null> {
  return env.DB.prepare(
    `
    SELECT *
    FROM war_control_snapshots
    WHERE war_id = ?
      AND bucket_start < ?
      AND bucket_start >= ?
    ORDER BY bucket_start DESC
    LIMIT 1
    `,
  )
    .bind(warId, bucketStart, bucketStart - transitionWindowMinutes * 60)
    .first<WarControlSnapshot>();
}

async function readWarControlHistory(env: Env, warId: number): Promise<WarControlSnapshot[]> {
  const rows = await env.DB.prepare(
    `
    SELECT *
    FROM war_control_snapshots
    WHERE war_id = ?
    ORDER BY bucket_start DESC
    LIMIT ?
    `,
  )
    .bind(warId, HISTORY_LIMIT)
    .all<WarControlSnapshot>();

  return [...(rows.results ?? [])].reverse();
}

function parseSnapshotReasons(snapshot: WarControlSnapshot | null): (WarControlSnapshot & { reasons: string[] }) | null {
  if (!snapshot) {
    return null;
  }
  let reasons: string[] = [];
  try {
    const parsed = JSON.parse(snapshot.reasons_json);
    reasons = Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    reasons = [];
  }
  return { ...snapshot, reasons };
}

function normalizeWarControlSettings(row: Partial<WarControlSettings> | null | undefined): WarControlSettings {
  return {
    id: 1,
    control_hospital_threshold: boundedNumber(row?.control_hospital_threshold, 0.5, 0.95, DEFAULT_WAR_CONTROL_SETTINGS.control_hospital_threshold),
    available_advantage_min: boundedNumber(row?.available_advantage_min, 0, 0.75, DEFAULT_WAR_CONTROL_SETTINGS.available_advantage_min),
    opening_grace_minutes: boundedInteger(row?.opening_grace_minutes, 0, 60, DEFAULT_WAR_CONTROL_SETTINGS.opening_grace_minutes),
    status_freshness_max_seconds: boundedInteger(row?.status_freshness_max_seconds, 30, 900, DEFAULT_WAR_CONTROL_SETTINGS.status_freshness_max_seconds),
    min_observed_roster_percent: boundedNumber(row?.min_observed_roster_percent, 0.1, 1, DEFAULT_WAR_CONTROL_SETTINGS.min_observed_roster_percent),
    min_local_relevant_members: boundedInteger(row?.min_local_relevant_members, 1, 100, DEFAULT_WAR_CONTROL_SETTINGS.min_local_relevant_members),
    heavy_own_hospital_penalty_threshold: boundedNumber(row?.heavy_own_hospital_penalty_threshold, 0, 1, DEFAULT_WAR_CONTROL_SETTINGS.heavy_own_hospital_penalty_threshold),
    severe_own_hospital_penalty_threshold: boundedNumber(row?.severe_own_hospital_penalty_threshold, 0, 1, DEFAULT_WAR_CONTROL_SETTINGS.severe_own_hospital_penalty_threshold),
    heavy_own_hospital_confidence_penalty: boundedNumber(row?.heavy_own_hospital_confidence_penalty, 0, 0.5, DEFAULT_WAR_CONTROL_SETTINGS.heavy_own_hospital_confidence_penalty),
    severe_own_hospital_confidence_penalty: boundedNumber(row?.severe_own_hospital_confidence_penalty, 0, 0.5, DEFAULT_WAR_CONTROL_SETTINGS.severe_own_hospital_confidence_penalty),
    transition_hospital_ratio_drop: boundedNumber(row?.transition_hospital_ratio_drop, 0.05, 0.75, DEFAULT_WAR_CONTROL_SETTINGS.transition_hospital_ratio_drop),
    transition_window_minutes: boundedInteger(row?.transition_window_minutes, 1, 60, DEFAULT_WAR_CONTROL_SETTINGS.transition_window_minutes),
    transition_min_attacks_5m: boundedInteger(row?.transition_min_attacks_5m, 0, 50, DEFAULT_WAR_CONTROL_SETTINGS.transition_min_attacks_5m),
    transition_big_hitter_multiplier_one: boundedNumber(row?.transition_big_hitter_multiplier_one, 1, 3, DEFAULT_WAR_CONTROL_SETTINGS.transition_big_hitter_multiplier_one),
    transition_big_hitter_multiplier_multiple: boundedNumber(row?.transition_big_hitter_multiplier_multiple, 1, 3, DEFAULT_WAR_CONTROL_SETTINGS.transition_big_hitter_multiplier_multiple),
    updated_at: Math.max(0, Math.floor(Number(row?.updated_at ?? 0))),
  };
}

function decision(
  state: WarControlState,
  confidence: number,
  reason: string,
  reasons: string[],
): { state: WarControlState; confidence: number; reason: string; reasons: string[] } {
  return {
    state,
    confidence: clampConfidence(confidence),
    reason,
    reasons,
  };
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function clampConfidence(value: number): number {
  return Math.min(0.95, Math.max(0, Math.round(value * 100) / 100));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPercent(value: number): string {
  const rounded = Math.round(value * 100);
  return rounded > 0 ? `+${rounded}%` : `${rounded}%`;
}
