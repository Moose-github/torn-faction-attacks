import { HOME_FACTION_ID } from "./constants";
import { sendDiscordMessage } from "./discord";
import { clearSyncLatch, readSetSyncLatches, setSyncLatch } from "./syncLatches";
import { Env, TornFactionMember } from "./types";
import { finiteNumber, json, nowSeconds } from "./utils";
import { readWarFromScoutingUrl } from "./warRequest";
import type { EnemyFactionMemberRow } from "./enemyScouting";

const PUSH_RECENT_ACTIVITY_WINDOW_SECONDS = 5 * 60;
const PUSH_REFERENCE_WINDOW_SECONDS = 10 * 60;
const PUSH_HISTORY_SECONDS = 24 * 60 * 60;
const HEATMAP_INTERVAL_MINUTES = 15;
const PUSH_ALERT_USER_MENTION = "<@327916221330620436>";
const PUSH_ALERT_ONLINE_MEMBER_LIMIT = 15;
const PUSH_UNDERWAY_ATTACK_COUNT_THRESHOLD = 6;
const PUSH_UNDERWAY_ATTACK_SIGNAL_COUNT_THRESHOLD = 3;
const PUSH_UNDERWAY_ATTACK_SIGNAL_SCORE_THRESHOLD = 13;
const PUSH_LIKELY_SCORE_THRESHOLD = 20;
export const PUSH_ALERT_STATE_PREFIX = "enemy_push_alert";

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

export type EnemyPushSnapshotInput = Omit<EnemyPushSnapshotRow, "created_at">;

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

export async function buildEnemyPushSnapshot(
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

export function upsertEnemyPushSnapshot(
  env: Env,
  snapshot: EnemyPushSnapshotInput,
): D1PreparedStatement {
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

export async function sendEnemyPushAlerts(
  env: Env,
  warId: number,
  warName: string,
  snapshot: EnemyPushSnapshotInput,
  members: TornFactionMember[] = [],
): Promise<void> {
  const likelyStateName = `${PUSH_ALERT_STATE_PREFIX}:${warId}:likely`;
  const underwayStateName = `${PUSH_ALERT_STATE_PREFIX}:${warId}:underway`;
  const setAlertStates = await readSetSyncLatches(env, [likelyStateName, underwayStateName]);

  if (snapshot.pressure_level === "underway") {
    await clearEnemyPushAlertIfSet(env, likelyStateName, setAlertStates);
    await sendEnemyPushAlertIfNeeded(
      env,
      underwayStateName,
      setAlertStates,
      formatEnemyPushAlertMessage("underway", warName, snapshot, members),
      snapshot.bucket_start,
    );
    return;
  }

  await clearEnemyPushAlertIfSet(env, underwayStateName, setAlertStates);
  if (snapshot.pressure_level === "likely") {
    await sendEnemyPushAlertIfNeeded(
      env,
      likelyStateName,
      setAlertStates,
      formatEnemyPushAlertMessage("likely", warName, snapshot, members),
      snapshot.bucket_start,
    );
    return;
  }

  await clearEnemyPushAlertIfSet(env, likelyStateName, setAlertStates);
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
  const currentActivityScore = Math.max(activeClusterScore, baselineScore);
  const mobilizationScore = Math.max(
    Math.max(0, values.onlineDelta10m),
    Math.max(0, values.recentlyActiveDelta10m),
    values.offlineIdleToOnlineCount * 2,
  );

  return (
    mobilizationScore +
    values.enemyAttacksLast5m * 3 +
    currentActivityScore
  );
}

function pushPressureLevel(score: number, enemyAttacksLast5m: number): string {
  if (
    enemyAttacksLast5m >= PUSH_UNDERWAY_ATTACK_COUNT_THRESHOLD ||
    (
      enemyAttacksLast5m >= PUSH_UNDERWAY_ATTACK_SIGNAL_COUNT_THRESHOLD &&
      score >= PUSH_UNDERWAY_ATTACK_SIGNAL_SCORE_THRESHOLD
    )
  ) {
    return "underway";
  }
  if (score >= PUSH_LIKELY_SCORE_THRESHOLD) {
    return "likely";
  }
  if (score >= 7) {
    return "building";
  }
  return "quiet";
}

async function sendEnemyPushAlertIfNeeded(
  env: Env,
  stateName: string,
  setAlertStates: Set<string>,
  message: string,
  sentAt: number,
): Promise<void> {
  if (setAlertStates.has(stateName)) {
    return;
  }

  await sendDiscordMessage(env, message);
  await setSyncLatch(env, stateName, sentAt);
  setAlertStates.add(stateName);
}

async function clearEnemyPushAlertIfSet(
  env: Env,
  stateName: string,
  setAlertStates: Set<string>,
): Promise<void> {
  if (!setAlertStates.has(stateName)) {
    return;
  }

  await clearSyncLatch(env, stateName);
  setAlertStates.delete(stateName);
}

function formatEnemyPushAlertMessage(
  alertType: "likely" | "underway",
  warName: string,
  snapshot: EnemyPushSnapshotInput,
  members: TornFactionMember[],
): string {
  const headline =
    alertType === "underway"
      ? `WIP enemy push alert: push appears to be happening currently for ${warName}.`
      : `WIP enemy push alert: push is likely happening soon for ${warName}.`;
  const reasons = enemyPushAlertReasons(snapshot);
  const onlineMembers = formatOnlineMembersForAlert(members);
  return `${PUSH_ALERT_USER_MENTION} ${headline} Score ${snapshot.pressure_score}.${reasons ? ` ${reasons}` : ""} ${onlineMembers}`;
}

function enemyPushAlertReasons(snapshot: EnemyPushSnapshotInput): string {
  const reasons: string[] = [];
  const mobilizationSignals = [
    {
      score: Math.max(0, snapshot.online_delta_10m),
      label: `+${snapshot.online_delta_10m} online in 10m`,
    },
    {
      score: Math.max(0, snapshot.recently_active_delta_10m),
      label: `+${snapshot.recently_active_delta_10m} recently active vs 10m ago`,
    },
    {
      score: snapshot.offline_idle_to_online_count * 2,
      label: `${snapshot.offline_idle_to_online_count} Offline/Idle -> Online`,
    },
  ];
  const strongestMobilization = mobilizationSignals
    .filter((signal) => signal.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  if (snapshot.enemy_attacks_last_5m > 0) {
    reasons.push(`${snapshot.enemy_attacks_last_5m} enemy attacks in 5m`);
  }
  if (strongestMobilization) {
    reasons.push(strongestMobilization.label);
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

function formatOnlineMembersForAlert(members: TornFactionMember[]): string {
  const onlineMembers = members
    .filter((member) => normalizeLastActionStatus(member.last_action?.status) === "online")
    .sort((left, right) => left.name.localeCompare(right.name));

  if (onlineMembers.length === 0) {
    return "Online now: none.";
  }

  const visibleMembers = onlineMembers
    .slice(0, PUSH_ALERT_ONLINE_MEMBER_LIMIT)
    .map((member) => `${discordSafeMemberName(member.name)} (${member.id})`);
  const remaining = onlineMembers.length - visibleMembers.length;
  const suffix = remaining > 0 ? `, +${remaining} more` : "";
  return `Online now (${onlineMembers.length}): ${visibleMembers.join(", ")}${suffix}.`;
}

function discordSafeMemberName(name: string): string {
  return name.replace(/\s+/g, " ").replace(/@/g, "(at)").trim() || "Unknown";
}

function activityHeatmapInterval(timestamp: number): number {
  const date = new Date(timestamp * 1000);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return Math.floor(minutes / HEATMAP_INTERVAL_MINUTES);
}
