import { bumpWarCacheVersionById } from "../cacheVersions";
import {
  CHAIN_BONUS_HITS_SQL,
  DEFEND_WON_RESULTS_SQL,
  HOME_FACTION_ID,
  POSITIVE_RESULTS_SQL,
} from "../constants";
import { OUTGOING_ACTION_WINDOW_SQL, RELEVANT_DEFEND_SQL } from "../sql";
import { Env } from "../types";
import { d1Changes, nowSeconds } from "../utils";
import { ATTACK_MEMBER_STAT_MERGE_SQL, DEFEND_MEMBER_STAT_MERGE_SQL } from "./sqlFragments";
import { warSummaryFromMemberStatsStatement } from "./warSummary";
import { memberRespectAveragesSql, respectAverageSql } from "./respectCounters";

const MEMBER_ACTIVITY_BUCKET_SECONDS = 15 * 60;
const WAR_STATS_REBUILD_LEASE_SECONDS = 15 * 60;
const WAR_STATS_REBUILD_LEASE_PREFIX = "war_stats_rebuild";
const PRACTICAL_DEFENSE_ACTION_WINDOW_SQL = OUTGOING_ACTION_WINDOW_SQL;
const COMBAT_BUCKET_STATS = ["attacks_successful", "assists_vs_enemy", "outside_hits", "defends_lost", "defends_won", "defends_other", "respect_gained", "respect_lost"];

// Wars own attacks through war_id and events through event_id, so an attack can
// count for both. One queue, war_stats_dirty, holds pending work for either.
type AttackOwner = "war_id" | "event_id";
// Attacks without a start time are queued under -1, matching the queue triggers.
const PENDING_BUCKET_SQL = `COALESCE(CAST(a.started / ${MEMBER_ACTIVITY_BUCKET_SECONDS} AS INTEGER) * ${MEMBER_ACTIVITY_BUCKET_SECONDS}, -1)`;

export type WarStatsRebuildScope = "single-war" | "all-wars";

export type WarStatsRebuildReason =
  | "admin"
  | "cron"
  | "lifecycle"
  | "maintenance"
  | "relink"
  | "finalize"
  | "compatibility";

export type WarStatsRebuildOptions = {
  scope: WarStatsRebuildScope;
  warId?: number;
  reason?: WarStatsRebuildReason;
};

export type WarStatsRebuildResult = {
  wars_rebuilt: number;
  combat_bucket_rows: number;
  wars_skipped?: number;
};

type WarStatsRebuildLease = {
  name: string;
  warId: number;
  claimedAt: number;
};

export class WarStatsRebuildLeaseError extends Error {
  readonly code = "WAR_STATS_REBUILD_LOCKED";
  readonly warId: number;

  constructor(warId: number) {
    super(`War stats rebuild is already running for war ${warId}`);
    this.name = "WarStatsRebuildLeaseError";
    this.warId = warId;
  }
}

export async function clearWarStats(env: Env, warId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM war_member_combat_buckets WHERE war_id = ?`).bind(warId),
    env.DB.prepare(`DELETE FROM war_member_stats WHERE war_id = ?`).bind(warId),
    env.DB.prepare(`DELETE FROM war_summary WHERE war_id = ?`).bind(warId),
  ]);
}

export async function applyIncrementalWarSummaries(env: Env, warId: number): Promise<void> {
  if (await applyPendingSummaries(env, warId)) {
    await bumpWarCacheVersionById(env, warId);
  }
}

/** Retry durable corrections even without new attacks, including ended wars and events. */
export async function refreshPendingWarSummaries(env: Env): Promise<void> {
  const rows = await env.DB.prepare("SELECT DISTINCT war_id FROM war_stats_dirty ORDER BY war_id").all<{ war_id: number }>();
  const errors: unknown[] = [];
  for (const { war_id } of rows.results ?? []) {
    try {
      await applyIncrementalWarSummaries(env, war_id);
    } catch (error) {
      // One bad war must not starve the others; its transaction keeps the queue.
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Unable to apply queued war corrections");
}

export async function rebuildWarStatsFromRaw(
  env: Env,
  options: WarStatsRebuildOptions,
): Promise<WarStatsRebuildResult> {
  const throwOnLeaseConflict = options.reason !== "cron";

  if (options.scope === "single-war") {
    return rebuildSingleWarStatsFromRaw(env, options.warId, throwOnLeaseConflict);
  }

  return rebuildAllWarStatsFromRaw(env, throwOnLeaseConflict);
}

export async function finalizeWar(env: Env, warId: number): Promise<void> {
  const war = (await env.DB.prepare(
    `
    SELECT id, finalized_at
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { id: number; finalized_at: number | null } | null;

  if (!war || war.finalized_at) {
    return;
  }

  await rebuildWarStatsFromRaw(env, {
    scope: "single-war",
    warId,
    reason: "finalize",
  });

  await env.DB.prepare(
    `
    UPDATE wars
    SET finalized_at = unixepoch()
    WHERE id = ?
    `,
  )
    .bind(warId)
    .run();

  await env.DB.prepare(`UPDATE war_summary SET updated_at = unixepoch() WHERE war_id = ?`)
    .bind(warId)
    .run();
}

export async function rebuildDerivedStatsFromRaw(env: Env, warId?: number): Promise<{
  wars_rebuilt: number;
  combat_bucket_rows: number;
}> {
  return rebuildWarStatsFromRaw(env, warId === undefined
    ? { scope: "all-wars", reason: "compatibility" }
    : { scope: "single-war", warId, reason: "compatibility" });
}

async function rebuildSingleWarStatsFromRaw(
  env: Env,
  warId: number | undefined,
  throwOnLeaseConflict: boolean,
): Promise<WarStatsRebuildResult> {
  if (warId === undefined) {
    return { wars_rebuilt: 0, combat_bucket_rows: 0 };
  }

  const war = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { id: number } | null;

  if (!war) {
    return { wars_rebuilt: 0, combat_bucket_rows: 0 };
  }

  const rebuilt = await rebuildKnownWarStatsFromRaw(env, war.id, throwOnLeaseConflict);

  return withSkippedWars({
    wars_rebuilt: rebuilt ? 1 : 0,
    combat_bucket_rows: await countWarMemberCombatBuckets(env, war.id),
  }, rebuilt ? 0 : 1);
}

async function rebuildAllWarStatsFromRaw(
  env: Env,
  throwOnLeaseConflict: boolean,
): Promise<WarStatsRebuildResult> {
  const rows = await env.DB.prepare(
    `
    SELECT id, status
    FROM wars
    ORDER BY practical_start_time ASC, id ASC
    `,
  ).all();

  const wars = (rows.results ?? []) as { id: number; status: string }[];
  let warsRebuilt = 0;
  let warsSkipped = 0;

  for (const war of wars) {
    const rebuilt = await rebuildKnownWarStatsFromRaw(env, war.id, throwOnLeaseConflict);
    if (rebuilt) {
      warsRebuilt += 1;
    } else {
      warsSkipped += 1;
    }
  }

  return withSkippedWars({
    wars_rebuilt: warsRebuilt,
    combat_bucket_rows: await countWarMemberCombatBuckets(env),
  }, warsSkipped);
}

async function rebuildKnownWarStatsFromRaw(
  env: Env,
  warId: number,
  throwOnLeaseConflict: boolean,
): Promise<boolean> {
  const lease = await claimWarStatsRebuildLease(env, warId);
  if (!lease) {
    if (throwOnLeaseConflict) {
      throw new WarStatsRebuildLeaseError(warId);
    }

    console.warn(`Skipped war stats rebuild for war ${warId}: rebuild lease is already held.`);
    return false;
  }

  try {
    await rebuildWarMemberStatsFromRaw(env, warId);
    return true;
  } finally {
    await releaseWarStatsRebuildLease(env, lease);
  }
}

async function claimWarStatsRebuildLease(
  env: Env,
  warId: number,
): Promise<WarStatsRebuildLease | null> {
  const claimedAt = nowSeconds();
  const name = warStatsRebuildLeaseName(warId);
  const result = await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      active_war_id = excluded.active_war_id,
      updated_at = CURRENT_TIMESTAMP
    WHERE sync_state.last_started < ?
    `,
  )
    .bind(name, claimedAt, warId, claimedAt - WAR_STATS_REBUILD_LEASE_SECONDS)
    .run();

  return d1Changes(result) > 0 ? { name, warId, claimedAt } : null;
}

async function releaseWarStatsRebuildLease(
  env: Env,
  lease: WarStatsRebuildLease,
): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM sync_state
    WHERE name = ?
      AND last_started = ?
      AND active_war_id = ?
    `,
  )
    .bind(lease.name, lease.claimedAt, lease.warId)
    .run()
    .catch((err: any) => {
      console.warn("Unable to release war stats rebuild lease:", err?.message || err);
    });
}

function warStatsRebuildLeaseName(warId: number): string {
  return `${WAR_STATS_REBUILD_LEASE_PREFIX}:${warId}`;
}

function withSkippedWars(
  result: WarStatsRebuildResult,
  warsSkipped: number,
): WarStatsRebuildResult {
  return warsSkipped > 0 ? { ...result, wars_skipped: warsSkipped } : result;
}

async function countWarMemberCombatBuckets(env: Env, warId?: number): Promise<number> {
  const row = warId === undefined
    ? await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM war_member_combat_buckets
      `,
    ).first()
    : await env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM war_member_combat_buckets
      WHERE war_id = ?
      `,
    )
      .bind(warId)
      .first();

  return Number((row as { count?: number | null } | null)?.count ?? 0);
}

export async function rebuildWarMemberStatsFromRaw(env: Env, warId: number): Promise<void> {
  // D1 batches are transactions: a concurrent ingestion batch either precedes
  // this snapshot or follows it. Acknowledge exactly the attacks it includes.
  await env.DB.batch([
    ...resetDerivedWarMemberStatsStatements(env, warId),
    env.DB.prepare(`DELETE FROM war_member_combat_buckets WHERE war_id = ?`).bind(warId),
    warMemberAttackStatsStatement(env, warId),
    warMemberDefendStatsStatement(env, warId),
    warMemberCombatBucketsStatement(env, warId),
    warSummaryFromMemberStatsStatement(env, warId),
    env.DB.prepare("UPDATE attacks INDEXED BY idx_attacks_pending_stats SET stats_pending = 0 WHERE war_id = ? AND stats_pending = 1").bind(warId),
    env.DB.prepare("DELETE FROM war_stats_dirty WHERE war_id = ?").bind(warId),
    env.DB.prepare("DELETE FROM war_respect_changes WHERE war_id = ?").bind(warId),
  ]);
}

/** Same queue as wars; the event's attacks are found through event_id. */
export async function applyIncrementalEventSummaries(env: Env, warId: number): Promise<boolean> {
  return applyPendingSummaries(env, warId);
}

async function applyPendingSummaries(env: Env, warId: number): Promise<boolean> {
  const war = await env.DB.prepare(`SELECT war_type FROM wars
    WHERE id = ? AND EXISTS (SELECT 1 FROM war_stats_dirty WHERE war_id = wars.id)`)
    .bind(warId).first<{ war_type: string | null }>();
  if (!war) return false;
  const owner: AttackOwner = war.war_type === "event" ? "event_id" : "war_id";
  const lease = await claimWarStatsRebuildLease(env, warId);
  if (!lease) return false;
  try {
    // Queue reads, exact replacements and acknowledgement share one transaction.
    // A late/corrected/deleted attack is therefore either included or stays queued.
    const results = await env.DB.batch([
      expandPendingWindowStatement(env, warId, owner),
      requeueBonusBucketsStatement(env, warId, owner),
      ...resetDerivedWarMemberStatsStatements(env, warId, owner),
      warMemberAttackStatsStatement(env, warId, owner),
      warMemberDefendStatsStatement(env, warId, owner),
      warMemberCombatBucketsStatement(env, warId, owner),
      deleteObsoletePendingBucketsStatement(env, warId),
      warSummaryFromMemberStatsStatement(env, warId),
      ...(owner === "war_id" ? [env.DB.prepare(
        "UPDATE attacks INDEXED BY idx_attacks_pending_stats SET stats_pending = 0 WHERE war_id = ? AND stats_pending = 1",
      ).bind(warId)] : []),
      env.DB.prepare("DELETE FROM war_respect_changes WHERE war_id = ?").bind(warId),
      env.DB.prepare("DELETE FROM war_stats_dirty WHERE war_id = ?").bind(warId),
    ]);
    return d1Changes(results[results.length - 1]) > 0;
  } finally {
    await releaseWarStatsRebuildLease(env, lease);
  }
}

function expandPendingWindowStatement(env: Env, warId: number, owner: AttackOwner): D1PreparedStatement {
  // Window/phase edits are uncommon. Their durable sentinel expands once, using
  // both stored rows and current attacks so removed contributions are cleared.
  return env.DB.prepare(`INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
    SELECT b.war_id, b.member_id, b.bucket_start FROM war_stats_dirty q
      CROSS JOIN war_member_combat_buckets b ON b.war_id = q.war_id
      WHERE q.war_id = ? AND q.member_id = -1
    UNION SELECT m.war_id, m.member_id, -1 FROM war_stats_dirty q
      CROSS JOIN war_member_stats m ON m.war_id = q.war_id
      WHERE q.war_id = ? AND q.member_id = -1
    UNION SELECT q.war_id, a.attacker_id, ${PENDING_BUCKET_SQL}
      FROM war_stats_dirty q CROSS JOIN ${ownedAttacksSql(owner, "attacker")} ON a.${owner} = q.war_id
      WHERE q.war_id = ? AND q.member_id = -1 AND a.attacker_faction_id = ${HOME_FACTION_ID} AND a.attacker_id IS NOT NULL
    UNION SELECT q.war_id, a.defender_id, ${PENDING_BUCKET_SQL}
      FROM war_stats_dirty q CROSS JOIN ${ownedAttacksSql(owner, "defender")} ON a.${owner} = q.war_id
      WHERE q.war_id = ? AND q.member_id = -1 AND a.defender_faction_id = ${HOME_FACTION_ID} AND a.defender_id IS NOT NULL
    ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING`).bind(warId, warId, warId, warId);
}

function requeueBonusBucketsStatement(env: Env, warId: number, owner: AttackOwner): D1PreparedStatement {
  // A bonus hit is valued at its attacker's ordinary-hit average, or the war-wide
  // average when the attacker has none. Revisit it only if that average may have
  // moved: the attacker's totals changed, or it has none and any total did.
  const bonusAttacks = `attacks a INDEXED BY ${owner === "war_id" ? "idx_attacks_war_bonus" : "idx_attacks_event_bonus"}`;
  return env.DB.prepare(`INSERT INTO war_stats_dirty (war_id, member_id, bucket_start)
    SELECT a.${owner}, a.attacker_id, ${PENDING_BUCKET_SQL}
    FROM ${bonusAttacks} WHERE a.${owner} = ? AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND a.attacker_id IS NOT NULL
      AND a.result IN (${POSITIVE_RESULTS_SQL}) AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
      AND ${bonusAverageMayHaveChangedSql("outgoing", `a.${owner}`)}
    UNION
    SELECT a.${owner}, a.defender_id, ${PENDING_BUCKET_SQL}
    FROM ${bonusAttacks} WHERE a.${owner} = ? AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND a.defender_id IS NOT NULL
      AND a.result IN (${POSITIVE_RESULTS_SQL}) AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
      AND ${bonusAverageMayHaveChangedSql("incoming", `a.${owner}`)}
    ON CONFLICT(war_id, member_id, bucket_start) DO NOTHING`).bind(warId, warId);
}

/** Unknown attackers never match a total, so they always use the war-wide average. */
function bonusAverageMayHaveChangedSql(direction: "outgoing" | "incoming", war: string): string {
  return `(EXISTS (SELECT 1 FROM war_respect_changes c WHERE c.war_id = ${war}
      AND c.direction = '${direction}' AND c.attacker_id = a.attacker_id)
    OR (EXISTS (SELECT 1 FROM war_respect_changes c WHERE c.war_id = ${war} AND c.direction = '${direction}')
      AND NOT EXISTS (SELECT 1 FROM war_respect_totals t WHERE t.war_id = ${war}
        AND t.direction = '${direction}' AND t.attacker_id = a.attacker_id AND t.hit_count > 0)))`;
}

/** Event reads name their index; the planner could otherwise choose a home-faction index and scan its history. */
function ownedAttacksSql(owner: AttackOwner, member: "attacker" | "defender", alias = "a"): string {
  return owner === "war_id" ? `attacks ${alias}` : `attacks ${alias} INDEXED BY idx_attacks_event_${member}_started`;
}

function pendingAttackSource(owner: AttackOwner | undefined, member: "attacker" | "defender", buckets = false): string {
  if (!owner) return "FROM tracker_attacks a";
  // CROSS JOIN fixes the queue as the driving input. The owner/member/time
  // indexes then read only affected member histories or bucket ranges.
  const pending = `(${buckets ? "SELECT *" : "SELECT DISTINCT war_id, member_id"} FROM war_stats_dirty) d`;
  const bucketRange = (alias: string) => buckets
    ? `AND ${alias}.started >= d.bucket_start AND ${alias}.started < d.bucket_start + ${MEMBER_ACTIVITY_BUCKET_SECONDS}` : "";
  if (owner === "war_id") {
    return `FROM ${pending}
    CROSS JOIN attacks a ON a.war_id = d.war_id AND a.${member}_id = d.member_id ${bucketRange("a")}`;
  }
  // The statements read a.war_id, so event attacks expose their event_id under that name.
  return `FROM (SELECT x.event_id AS war_id, ${EVENT_ATTACK_COLUMNS.map(column => `x.${column}`).join(", ")}
    FROM ${pending}
    CROSS JOIN ${ownedAttacksSql(owner, member, "x")} ON x.event_id = d.war_id
      AND x.${member}_id = d.member_id ${bucketRange("x")}) a`;
}

const EVENT_ATTACK_COLUMNS = [
  "id", "code", "started", "ended",
  "attacker_id", "attacker_name", "attacker_level", "attacker_faction_id", "attacker_faction_name",
  "defender_id", "defender_name", "defender_level", "defender_faction_id", "defender_faction_name",
  "result", "respect_gain", "respect_loss", "chain", "is_interrupted",
  "is_stealthed", "is_raid", "is_ranked_war", "m_fair_fight", "m_war",
  "m_retaliation", "m_group", "m_overseas", "m_chain", "m_warlord",
  "fetched_at", "ingest_run_id", "stats_pending",
];

function pendingMemberSql(member: string, war = "a.war_id", bucket?: string): string {
  return `EXISTS (SELECT 1 FROM war_stats_dirty d WHERE d.war_id = ${war}
    AND d.member_id = ${member}${bucket ? ` AND d.bucket_start = ${bucket}` : ""})`;
}

/** Recalculate respect from stored attacks; callers authenticate the member separately. */
export async function recalculateWarMemberRespectFromRaw(
  env: Env,
  warId: number,
  memberId: number,
): Promise<Record<string, unknown> | null> {
  const lease = await claimWarStatsRebuildLease(env, warId);
  if (!lease) throw new WarStatsRebuildLeaseError(warId);

  try {
    const memberStatement = env.DB.prepare(
      "SELECT * FROM war_member_stats WHERE war_id = ? AND member_id = ? LIMIT 1",
    ).bind(warId, memberId);
    if (!await memberStatement.first()) return null;

    // Keep the member, summary, and returned snapshot consistent with ingestion.
    const results = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare(`
        UPDATE war_member_stats
        SET respect_gained = 0,
            respect_gained_raw = 0,
            chain_bonus_hits_vs_enemy = 0,
            chain_bonus_respect_removed = 0,
            chain_bonus_hit_values_vs_enemy = '',
            chain_bonus_hit_details_vs_enemy = '',
            respect_lost = 0,
            respect_lost_non_hospitalized = 0,
            respect_lost_raw = 0,
            enemy_chain_bonus_hits_received = 0,
            enemy_chain_bonus_respect_removed = 0,
            enemy_chain_bonus_hit_values_received = '',
            enemy_chain_bonus_hit_details_received = ''
        WHERE war_id = ? AND member_id = ?
      `).bind(warId, memberId),
      warOutgoingRespectStatement(env, warId, memberId),
      warDefendRespectStatement(env, warId, memberId),
      warSummaryFromMemberStatsStatement(env, warId),
      memberStatement,
    ]);
    return results[4].results[0] ?? null;
  } finally {
    await releaseWarStatsRebuildLease(env, lease);
  }
}

function warOutgoingRespectStatement(
  env: Env,
  warId: number,
  memberId?: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    WITH chain_members AS (
      ${memberId === undefined ? `
      SELECT DISTINCT a.attacker_id AS member_id
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
      ` : "SELECT ? AS member_id"}
    ),
    member_averages AS (
      SELECT
        a.attacker_id AS member_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      JOIN chain_members cm ON cm.member_id = a.attacker_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      respect_gained,
      respect_gained_raw,
      chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_gained,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_gained_raw,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS chain_bonus_hits_vs_enemy,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS chain_bonus_hit_values_vs_enemy,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS chain_bonus_hit_details_vs_enemy
    FROM tracker_attacks a
    JOIN wars w ON w.id = a.war_id
    JOIN chain_members cm ON cm.member_id = a.attacker_id
    JOIN war_member_stats existing ON existing.war_id = a.war_id AND existing.member_id = a.attacker_id
    LEFT JOIN member_averages ma ON ma.member_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ${HOME_FACTION_ID}
      AND a.attacker_id IS NOT NULL
      AND ${OUTGOING_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      respect_gained = excluded.respect_gained,
      respect_gained_raw = excluded.respect_gained_raw,
      chain_bonus_hits_vs_enemy = excluded.chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed = excluded.chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy = excluded.chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy = excluded.chain_bonus_hit_details_vs_enemy
    `,
  )
    .bind(memberId ?? warId, warId, warId, warId);
}

function warDefendRespectStatement(
  env: Env,
  warId: number,
  memberId?: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    WITH chain_defenders AS (
      ${memberId === undefined ? `
      SELECT DISTINCT a.defender_id AS member_id
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
      ` : "SELECT ? AS member_id"}
    ),
    member_averages AS (
      SELECT
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.attacker_id
    ),
    war_average AS (
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      respect_lost,
      respect_lost_non_hospitalized,
      respect_lost_raw,
      enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.result != 'Hospitalized'
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost_non_hospitalized,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_lost_raw,
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS enemy_chain_bonus_hits_received,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS enemy_chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS enemy_chain_bonus_hit_values_received,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS enemy_chain_bonus_hit_details_received
    FROM tracker_attacks a
    JOIN wars w ON w.id = a.war_id
    JOIN chain_defenders cd ON cd.member_id = a.defender_id
    JOIN war_member_stats existing ON existing.war_id = a.war_id AND existing.member_id = a.defender_id
    LEFT JOIN member_averages ma ON ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND a.defender_id IS NOT NULL
      AND ${RELEVANT_DEFEND_SQL}
      AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      respect_lost = excluded.respect_lost,
      respect_lost_non_hospitalized = excluded.respect_lost_non_hospitalized,
      respect_lost_raw = excluded.respect_lost_raw,
      enemy_chain_bonus_hits_received = excluded.enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed = excluded.enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received = excluded.enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received = excluded.enemy_chain_bonus_hit_details_received
    `,
  )
    .bind(memberId ?? warId, warId, warId, warId);
}

function resetDerivedWarMemberStatsStatements(env: Env, warId?: number, pendingOwner?: AttackOwner): D1PreparedStatement[] {
  const whereClause = (warId === undefined ? "" : "WHERE war_id = ?") + (pendingOwner
    ? ` AND ${pendingMemberSql("war_member_stats.member_id", "war_member_stats.war_id")}` : "");
  const bindValue = warId === undefined ? [] : [warId];

  const resetStatement = env.DB.prepare(
    `
    UPDATE war_member_stats
    SET attacks_vs_enemy_total = 0,
        attacks_vs_enemy_successful = 0,
        respect_gained = 0,
        respect_gained_raw = 0,
        chain_bonus_hits_vs_enemy = 0,
        chain_bonus_respect_removed = 0,
        chain_bonus_hit_values_vs_enemy = '',
        chain_bonus_hit_details_vs_enemy = '',
        assists_vs_enemy = 0,
        hospitalizations_vs_enemy = 0,
        mugs_vs_enemy = 0,
        retaliations_vs_enemy = 0,
        outside_hits = 0,
        friendly_hosps = 0,
        average_fair_fight = NULL,
        defends_total = 0,
        defends_won = 0,
        defends_other = 0,
        defends_lost_non_hospitalized = 0,
        respect_lost = 0,
        respect_lost_non_hospitalized = 0,
        respect_lost_raw = 0,
        enemy_chain_bonus_hits_received = 0,
        enemy_chain_bonus_respect_removed = 0,
        enemy_chain_bonus_hit_values_received = '',
        enemy_chain_bonus_hit_details_received = '',
        first_action_at = NULL,
        last_action_at = NULL
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} added_from_report = 1
    `,
  );
  const deleteStatement = env.DB.prepare(
    `
    DELETE FROM war_member_stats
    ${whereClause}
      ${whereClause ? "AND" : "WHERE"} added_from_report = 0
    `,
  );
  return bindValue.length > 0
    ? [resetStatement.bind(...bindValue), deleteStatement.bind(...bindValue)]
    : [resetStatement, deleteStatement];
}

function warMemberAttackStatsStatement(
  env: Env,
  warId: number,
  pendingOwner?: AttackOwner,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    WITH member_averages AS (
      ${pendingOwner ? memberRespectAveragesSql("outgoing") : `
      SELECT
        a.war_id,
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.war_id, a.attacker_id
      `}
    ),
    war_average AS (
      ${pendingOwner ? respectAverageSql("outgoing") : `
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${OUTGOING_ACTION_WINDOW_SQL}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      `}
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      attacks_vs_enemy_total,
      attacks_vs_enemy_successful,
      respect_gained,
      respect_gained_raw,
      chain_bonus_hits_vs_enemy,
      chain_bonus_respect_removed,
      chain_bonus_hit_values_vs_enemy,
      chain_bonus_hit_details_vs_enemy,
      assists_vs_enemy,
      hospitalizations_vs_enemy,
      mugs_vs_enemy,
      retaliations_vs_enemy,
      outside_hits,
      friendly_hosps,
      average_fair_fight,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.attacker_id,
      MAX(a.attacker_name),
      SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_total,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN 1
        ELSE 0
      END) AS attacks_vs_enemy_successful,
      COALESCE(SUM(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
           AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_gained,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_gained_raw,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS chain_bonus_hits_vs_enemy,
      COALESCE(SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS chain_bonus_hit_values_vs_enemy,
      COALESCE(GROUP_CONCAT(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS chain_bonus_hit_details_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Assist'
        THEN 1
        ELSE 0
      END) AS assists_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS hospitalizations_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Mugged'
        THEN 1
        ELSE 0
      END) AS mugs_vs_enemy,
      SUM(CASE
        WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
         AND a.result = 'Hospitalized'
         AND COALESCE(a.m_retaliation, 1) > 1
        THEN 1
        ELSE 0
      END) AS retaliations_vs_enemy,
      SUM(CASE
        WHEN w.enemy_faction_id IS NOT NULL
         AND (
           a.defender_faction_id IS NULL
           OR a.defender_faction_id != w.enemy_faction_id
         )
         AND NOT (
           a.defender_faction_id = ${HOME_FACTION_ID}
           AND a.result = 'Hospitalized'
         )
        THEN 1
        ELSE 0
      END) AS outside_hits,
      SUM(CASE
        WHEN a.result = 'Hospitalized'
         AND a.defender_faction_id = ${HOME_FACTION_ID}
        THEN 1
        ELSE 0
      END) AS friendly_hosps,
      AVG(CASE
        WHEN w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id
        THEN a.m_fair_fight
        ELSE NULL
      END) AS average_fair_fight,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    ${pendingAttackSource(pendingOwner, "attacker")}
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.war_id = a.war_id AND ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.attacker_faction_id = ?
      AND a.attacker_id IS NOT NULL
      AND ${OUTGOING_ACTION_WINDOW_SQL}
      ${pendingOwner ? `AND ${pendingMemberSql("a.attacker_id")}` : ""}
    GROUP BY a.war_id, a.attacker_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
${ATTACK_MEMBER_STAT_MERGE_SQL}
    `,
  )
    .bind(warId, warId, warId, HOME_FACTION_ID);
}

export function warMemberCombatBucketsCte(
  outgoingWindowSql = OUTGOING_ACTION_WINDOW_SQL,
  defenseWindowSql = PRACTICAL_DEFENSE_ACTION_WINDOW_SQL,
  pendingOwner?: AttackOwner,
): string {
  return `
    WITH outgoing_member_averages AS (
      ${pendingOwner ? memberRespectAveragesSql("outgoing", "member_id") : `
      SELECT
        a.attacker_id AS member_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${outgoingWindowSql}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      GROUP BY a.attacker_id
      `}
    ),
    outgoing_war_average AS (
      ${pendingOwner ? respectAverageSql("outgoing") : `
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND ${outgoingWindowSql}
        AND (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
      `}
    ),
    defend_member_averages AS (
      ${pendingOwner ? memberRespectAveragesSql("incoming") : `
      SELECT
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${defenseWindowSql}
      GROUP BY a.attacker_id
      `}
    ),
    defend_war_average AS (
      ${pendingOwner ? respectAverageSql("incoming") : `
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${defenseWindowSql}
      `}
    ),
    bucket_rows AS (
      SELECT
        a.war_id,
        a.attacker_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS attacks_successful,
        SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result = 'Assist'
          THEN 1
          ELSE 0
        END) AS assists_vs_enemy,
        SUM(CASE
          WHEN w.enemy_faction_id IS NOT NULL
           AND (
             a.defender_faction_id IS NULL
             OR a.defender_faction_id != w.enemy_faction_id
           )
           AND NOT (
             a.defender_faction_id = ${HOME_FACTION_ID}
             AND a.result = 'Hospitalized'
           )
          THEN 1
          ELSE 0
        END) AS outside_hits,
        0 AS defends_lost,
        0 AS defends_won,
        0 AS defends_other,
        COALESCE(SUM(CASE
          WHEN (w.enemy_faction_id IS NULL OR a.defender_faction_id = w.enemy_faction_id)
           AND a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(oma.avg_respect, owa.avg_respect, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_gained,
        0 AS respect_lost
      ${pendingAttackSource(pendingOwner, "attacker", true)}
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN outgoing_member_averages oma ON oma.member_id = a.attacker_id
      LEFT JOIN outgoing_war_average owa ON 1 = 1
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
        AND a.attacker_faction_id = ${HOME_FACTION_ID}
        AND a.attacker_id IS NOT NULL
        AND ${outgoingWindowSql}
        ${pendingOwner ? `AND ${pendingMemberSql("a.attacker_id", "a.war_id", `CAST(a.started / ${MEMBER_ACTIVITY_BUCKET_SECONDS} AS INTEGER) * ${MEMBER_ACTIVITY_BUCKET_SECONDS}`)}` : ""}
      GROUP BY a.war_id, a.attacker_id, bucket_start
      HAVING attacks_successful > 0
        OR assists_vs_enemy > 0
        OR outside_hits > 0
        OR respect_gained > 0

      UNION ALL

      SELECT
        a.war_id,
        a.defender_id AS member_id,
        CAST((a.started / ?) AS INTEGER) * ? AS bucket_start,
        0 AS attacks_successful,
        0 AS assists_vs_enemy,
        0 AS outside_hits,
        SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS defends_lost,
        SUM(CASE
          WHEN a.result IN (${DEFEND_WON_RESULTS_SQL})
          THEN 1
          ELSE 0
        END) AS defends_won,
        SUM(CASE
          WHEN a.result IS NULL
            OR (
              a.result NOT IN (${POSITIVE_RESULTS_SQL})
              AND a.result NOT IN (${DEFEND_WON_RESULTS_SQL})
            )
          THEN 1
          ELSE 0
        END) AS defends_other,
        0 AS respect_gained,
        COALESCE(SUM(CASE
          WHEN a.result IN (${POSITIVE_RESULTS_SQL})
          THEN CASE
            WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
            THEN COALESCE(dma.avg_respect, dwa.avg_respect, 0)
            ELSE a.respect_gain
          END
          ELSE 0
        END), 0) AS respect_lost
      ${pendingAttackSource(pendingOwner, "defender", true)}
      JOIN wars w ON w.id = a.war_id
      LEFT JOIN defend_member_averages dma ON dma.attacker_id = a.attacker_id
      LEFT JOIN defend_war_average dwa ON 1 = 1
      WHERE a.war_id = ?
        AND a.started IS NOT NULL
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND ${defenseWindowSql}
        ${pendingOwner ? `AND ${pendingMemberSql("a.defender_id", "a.war_id", `CAST(a.started / ${MEMBER_ACTIVITY_BUCKET_SECONDS} AS INTEGER) * ${MEMBER_ACTIVITY_BUCKET_SECONDS}`)}` : ""}
      GROUP BY a.war_id, a.defender_id, bucket_start
      HAVING defends_lost > 0
        OR defends_won > 0
        OR defends_other > 0
        OR respect_lost > 0
    ),
    grouped_rows AS (
      SELECT
        war_id,
        member_id,
        bucket_start,
        SUM(attacks_successful) AS attacks_successful,
        SUM(assists_vs_enemy) AS assists_vs_enemy,
        SUM(outside_hits) AS outside_hits,
        SUM(defends_lost) AS defends_lost,
        SUM(defends_won) AS defends_won,
        SUM(defends_other) AS defends_other,
        SUM(respect_gained) AS respect_gained,
        SUM(respect_lost) AS respect_lost
      FROM bucket_rows
      GROUP BY war_id, member_id, bucket_start
    )
  `;
}

function warMemberCombatBucketsStatement(
  env: Env,
  warId: number,
  pendingOwner?: AttackOwner,
): D1PreparedStatement {
  // A queued bucket that no longer has contributing attacks is replaced with
  // zeros, then removed in the same transaction. Only already stored buckets
  // need that placeholder; empty queue entries must not create new rows.
  // This avoids evaluating the historical averages/grouping again for cleanup.
  const bucketRowsSql = pendingOwner ? `
    SELECT d.war_id, d.member_id, d.bucket_start,
      ${COMBAT_BUCKET_STATS.map(column => `COALESCE(g.${column}, 0)`).join(", ")}
    FROM war_stats_dirty d
    LEFT JOIN grouped_rows g ON g.war_id = d.war_id
      AND g.member_id = d.member_id AND g.bucket_start = d.bucket_start
    WHERE d.war_id = ? AND (g.war_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM war_member_combat_buckets b WHERE b.war_id = d.war_id
        AND b.member_id = d.member_id AND b.bucket_start = d.bucket_start
    ))` : `
    SELECT war_id, member_id, bucket_start, ${COMBAT_BUCKET_STATS.join(", ")}
    FROM grouped_rows
    WHERE true`;
  return env.DB.prepare(
    `
    ${warMemberCombatBucketsCte(undefined, undefined, pendingOwner)}
    INSERT INTO war_member_combat_buckets (
      war_id, member_id, bucket_start, ${COMBAT_BUCKET_STATS.join(", ")}
    )
    ${bucketRowsSql}
    ON CONFLICT(war_id, member_id, bucket_start) DO UPDATE SET
      ${COMBAT_BUCKET_STATS.map(column => `${column} = ${pendingOwner ? "" : `war_member_combat_buckets.${column} + `}excluded.${column}`).join(",\n      ")}
      ${pendingOwner ? `WHERE ${COMBAT_BUCKET_STATS.map(column => `war_member_combat_buckets.${column} IS NOT excluded.${column}`).join(" OR ")}` : ""}
    `,
  ).bind(...combatBucketBindings(warId), ...(pendingOwner ? [warId] : []));
}

function deleteObsoletePendingBucketsStatement(env: Env, warId: number): D1PreparedStatement {
  // Nonempty grouped rows always have a positive action count. The upsert above
  // therefore leaves zeros only for obsolete buckets, without a second raw scan.
  return env.DB.prepare(`
    DELETE FROM war_member_combat_buckets
    WHERE (war_id, member_id, bucket_start) IN (
      SELECT war_id, member_id, bucket_start FROM war_stats_dirty WHERE war_id = ?
    )
      AND ${COMBAT_BUCKET_STATS.map(column => `${column} = 0`).join(" AND ")}
  `).bind(warId);
}

function combatBucketBindings(warId: number): number[] {
  return [
    warId,
    warId,
    warId,
    warId,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    warId,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    MEMBER_ACTIVITY_BUCKET_SECONDS,
    warId,
  ];
}

function warMemberDefendStatsStatement(
  env: Env,
  warId: number,
  pendingOwner?: AttackOwner,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    WITH member_averages AS (
      ${pendingOwner ? memberRespectAveragesSql("incoming") : `
      SELECT
        a.attacker_id,
        AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
      GROUP BY a.attacker_id
      `}
    ),
    war_average AS (
      ${pendingOwner ? respectAverageSql("incoming") : `
      SELECT AVG(a.respect_gain) AS avg_respect
      FROM tracker_attacks a
      JOIN wars w ON w.id = a.war_id
      WHERE a.war_id = ?
        AND a.defender_faction_id = ${HOME_FACTION_ID}
        AND a.defender_id IS NOT NULL
        AND ${RELEVANT_DEFEND_SQL}
        AND a.result IN (${POSITIVE_RESULTS_SQL})
        AND (a.chain IS NULL OR a.chain NOT IN (${CHAIN_BONUS_HITS_SQL}))
        AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
      `}
    )
    INSERT INTO war_member_stats (
      war_id,
      member_id,
      member_name,
      defends_total,
      defends_won,
      defends_other,
      defends_lost_non_hospitalized,
      respect_lost,
      respect_lost_non_hospitalized,
      respect_lost_raw,
      enemy_chain_bonus_hits_received,
      enemy_chain_bonus_respect_removed,
      enemy_chain_bonus_hit_values_received,
      enemy_chain_bonus_hit_details_received,
      first_action_at,
      last_action_at
    )
    SELECT
      a.war_id,
      a.defender_id,
      MAX(a.defender_name),
      COUNT(*) AS defends_total,
      SUM(CASE
        WHEN a.result IN (${DEFEND_WON_RESULTS_SQL}) THEN 1
        ELSE 0
      END) AS defends_won,
      SUM(CASE
        WHEN a.result IS NULL
          OR (
            a.result NOT IN (${POSITIVE_RESULTS_SQL})
            AND a.result NOT IN (${DEFEND_WON_RESULTS_SQL})
          )
        THEN 1
        ELSE 0
      END) AS defends_other,
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.result != 'Hospitalized'
        THEN 1
        ELSE 0
      END) AS defends_lost_non_hospitalized,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.result != 'Hospitalized'
        THEN CASE
          WHEN a.chain IN (${CHAIN_BONUS_HITS_SQL})
          THEN COALESCE(ma.avg_respect, wa.avg_respect, 0)
          ELSE a.respect_gain
        END
        ELSE 0
      END), 0) AS respect_lost_non_hospitalized,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
        THEN a.respect_gain
        ELSE 0
      END), 0) AS respect_lost_raw,
      SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN 1
        ELSE 0
      END) AS enemy_chain_bonus_hits_received,
      COALESCE(SUM(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.respect_gain - COALESCE(ma.avg_respect, wa.avg_respect, 0)
        ELSE 0
      END), 0) AS enemy_chain_bonus_respect_removed,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain
        ELSE NULL
      END, ', '), '') AS enemy_chain_bonus_hit_values_received,
      COALESCE(GROUP_CONCAT(CASE
        WHEN a.result IN (${POSITIVE_RESULTS_SQL})
         AND a.chain IN (${CHAIN_BONUS_HITS_SQL})
        THEN a.chain || ' - ' || printf('%g', ROUND(COALESCE(ma.avg_respect, wa.avg_respect, 0), 1)) || ' respect'
        ELSE NULL
      END, char(10)), '') AS enemy_chain_bonus_hit_details_received,
      MIN(a.started) AS first_action_at,
      MAX(a.started) AS last_action_at
    ${pendingAttackSource(pendingOwner, "defender")}
    JOIN wars w ON w.id = a.war_id
    LEFT JOIN member_averages ma ON ma.attacker_id = a.attacker_id
    LEFT JOIN war_average wa ON 1 = 1
    WHERE a.war_id = ?
      AND a.defender_faction_id = ?
      AND a.defender_id IS NOT NULL
      AND ${RELEVANT_DEFEND_SQL}
      AND ${PRACTICAL_DEFENSE_ACTION_WINDOW_SQL}
      ${pendingOwner ? `AND ${pendingMemberSql("a.defender_id")}` : ""}
    GROUP BY a.war_id, a.defender_id
    ON CONFLICT(war_id, member_id) DO UPDATE SET
${DEFEND_MEMBER_STAT_MERGE_SQL}
    `,
  )
    .bind(warId, warId, warId, HOME_FACTION_ID);
}
