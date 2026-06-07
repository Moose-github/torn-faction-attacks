import {
  API_URL,
  HOME_FACTION_ID,
  LIMIT,
  OVERLAP_SECONDS,
  RANKED_WARS_API_URL,
  SOURCE_NAME,
} from "./constants";
import { sendDiscordMessage } from "./discord";
import { fetchEnemyScoutingOnceForWar } from "./enemyScouting";
import { applyRankedWarReport, fetchTornRankedWarReport } from "./reports";
import {
  applyIncrementalWarSummaries,
  finalizeWar,
} from "./summaries";
import {
  insertSyncStateIfMissing,
  readSyncState,
  upsertSyncTimestamp,
} from "./syncState";
import {
  Env,
  TornAttack,
  TornAttackResponse,
  TornRankedWar,
  TornRankedWarFaction,
  TornRankedWarResponse,
} from "./types";
import { fetchTrackedTornJson } from "./external/torn";
import { boolToInt, d1Changes, json, normalizeAttacks, nowSeconds } from "./utils";
import {
  applyTornOfficialWarEnd,
  recordTermedWarPracticalFinish,
  startWarTracking,
} from "./warLifecycle";

type IngestionRunMetrics = {
  id: string;
  triggerSource: string;
  startedAt: number;
  rankedWarCheckedAt: number | null;
  attacksFetchFinishedAt: number | null;
  d1WritesFinishedAt: number | null;
  statsFinishedAt: number | null;
  reportFinishedAt: number | null;
  finishedAt: number | null;
  activeWarId: number | null;
  fetchedPages: number;
  fetchedAttacks: number;
  wroteBatches: number;
  attackWriteStatements: number;
  syncStateWrites: number;
  statWriteOperations: number;
  reportWriteOperations: number;
  sawRows: boolean;
  latestAttackStarted: number;
  error: string | null;
};

const NOOP_CRON_INGESTION_METRIC_INTERVAL_SECONDS = 5 * 60;

export type TermedWarCrossingAttackRow = {
  id: number;
  started: number | null;
  ended: number | null;
  attacker_name?: string | null;
  defender_name?: string | null;
  respect_gain: number | null;
};

export type WarWindowForAttackAssignment = {
  practical_start_time: number;
  practical_finish_time: number | null;
  official_end_time: number | null;
};

export type AttackTiming = {
  started?: number | null;
  ended?: number | null;
};

export type RecentAttackIngestionResult = {
  fetched_pages: number;
  fetched_attacks: number;
  inserted_attacks: number;
  from: number;
  to: number;
};

const RECENT_ATTACK_LIGHT_SYNC_PAGE_LIMIT = 3;

export async function runIngestion(
  env: Env,
  triggerSource = "cron",
  _options: { scheduledTime?: number } = {},
): Promise<void> {
  const metrics: IngestionRunMetrics = {
    id: crypto.randomUUID(),
    triggerSource,
    startedAt: nowSeconds(),
    rankedWarCheckedAt: null,
    attacksFetchFinishedAt: null,
    d1WritesFinishedAt: null,
    statsFinishedAt: null,
    reportFinishedAt: null,
    finishedAt: null,
    activeWarId: null,
    fetchedPages: 0,
    fetchedAttacks: 0,
    wroteBatches: 0,
    attackWriteStatements: 0,
    syncStateWrites: 0,
    statWriteOperations: 0,
    reportWriteOperations: 0,
    sawRows: false,
    latestAttackStarted: 0,
    error: null,
  };

  try {
    await ensureState(env);
    const latestRankedWar = await fetchLatestRankedWar(env).catch((err) => {
      console.error("Torn ranked wars sync failed:", err?.message || err);
      return null;
    });
    await syncUpcomingRankedWar(env, latestRankedWar);
    await activateScheduledWarIfDue(env);
    metrics.rankedWarCheckedAt = nowSeconds();

    const state = await readSyncState(env, SOURCE_NAME);

    const activeWar = state?.active_war_id
      ? ((await env.DB.prepare(
          `
          SELECT
            id,
            name,
            practical_start_time,
            status,
            war_type,
            enemy_faction_id,
            torn_war_id,
            practical_finish_time,
            official_end_time,
            auto_end_enabled,
            faction_respect_limit,
            official_home_score,
            official_enemy_score
          FROM wars
          WHERE id = ? AND status = 'active'
          LIMIT 1
          `,
        )
          .bind(state.active_war_id)
          .first()) as ActiveWarForIngestion | null)
      : null;
    metrics.activeWarId = activeWar?.id ?? null;
    const officialEndTime =
      activeWar && latestRankedWar ? await syncActiveWarOfficialEnd(env, activeWar, latestRankedWar) : null;
    if (activeWar && latestRankedWar && officialEndTime === null) {
      await syncRankedWarScores(env, activeWar, latestRankedWar);
    }
    if (!activeWar && latestRankedWar) {
      await syncUnfinishedRankedWar(env, latestRankedWar);
    }
    const ingestionWar = activeWar
      ? {
          ...activeWar,
          official_end_time: officialEndTime ?? activeWar.official_end_time,
        }
      : null;

    let from = Math.max(0, (state?.last_started ?? 0) - OVERLAP_SECONDS);
    let newestStarted = state?.last_started ?? 0;
    let persistedStarted = state?.last_started ?? 0;
    const ingestRunId = crypto.randomUUID();
    let newOrAssignedWarAttackCount = 0;

    while (true) {
      const data = await fetchAttacks(env, from);
      const attacks = normalizeAttacks(data.attacks);
      metrics.fetchedPages += 1;
      metrics.fetchedAttacks += attacks.length;

      if (attacks.length === 0) {
        break;
      }

      metrics.sawRows = true;
      const statements: D1PreparedStatement[] = [];
      const warWriteFlags: boolean[] = [];
      const existingAttackRows = await readExistingAttackRows(env, attacks.map((attack) => attack.id));
      let pageNewestStarted = newestStarted;

      for (const attack of attacks) {
        pageNewestStarted = Math.max(pageNewestStarted, attack.started ?? 0);

        const warId =
          ingestionWar && attackFallsWithinLiveWarWindow(attack, ingestionWar)
            ? ingestionWar.id
            : null;

        const existingAttack = existingAttackRows.get(attack.id);
        if (existingAttack) {
          if (warId !== null && existingAttack.war_id === null) {
            statements.push(buildLiveWarAssignmentStatement(env, ingestRunId, warId, attack.id));
            warWriteFlags.push(true);
          }
          continue;
        }

        statements.push(buildLiveInsertStatement(env, ingestRunId, warId, attack));
        warWriteFlags.push(warId !== null);
      }

      if (statements.length > 0) {
        const writeResults = await env.DB.batch(statements);
        newOrAssignedWarAttackCount += writeResults.reduce(
          (count, result, index) => count + (warWriteFlags[index] ? d1Changes(result) : 0),
          0,
        );
        metrics.wroteBatches += 1;
        metrics.attackWriteStatements += statements.length;
      }

      newestStarted = pageNewestStarted;

      if (newestStarted > persistedStarted) {
        await upsertSyncTimestamp(env, SOURCE_NAME, newestStarted);
        persistedStarted = newestStarted;
        metrics.syncStateWrites += 1;
      }

      if (attacks.length < LIMIT) {
        break;
      }

      from = newestStarted;
    }
    metrics.latestAttackStarted = newestStarted;
    metrics.attacksFetchFinishedAt = nowSeconds();
    metrics.d1WritesFinishedAt = metrics.attacksFetchFinishedAt;

    if (!ingestionWar) {
      return;
    }

    if (newOrAssignedWarAttackCount > 0) {
      await applyIncrementalWarSummaries(env, ingestionWar.id, ingestRunId);
      metrics.statWriteOperations += 1;
      metrics.statsFinishedAt = nowSeconds();
    }

    if (ingestionWar && officialEndTime !== null) {
      await fetchAndApplyRankedWarReport(env, ingestionWar, latestRankedWar?.id ?? ingestionWar.torn_war_id);
      await finalizeWar(env, ingestionWar.id);
      metrics.reportWriteOperations += 1;
      metrics.statWriteOperations += 1;
      metrics.reportFinishedAt = nowSeconds();
      metrics.statsFinishedAt = metrics.reportFinishedAt;
    } else if (ingestionWar) {
      const autoEnded = await autoEndTermedWarIfLimitReached(env, ingestionWar, latestRankedWar);
      if (autoEnded) {
        metrics.reportWriteOperations += 1;
        metrics.statWriteOperations += 1;
        metrics.statsFinishedAt = nowSeconds();
      }
    }
  } catch (err: any) {
    metrics.error = err?.message || String(err);
    throw err;
  } finally {
    metrics.finishedAt = nowSeconds();
    await writeFinalIngestionRunMetric(env, metrics);
  }
}

type ActiveWarForIngestion = {
  id: number;
  name: string;
  practical_start_time: number;
  status: string;
  war_type: string | null;
  enemy_faction_id: number | null;
  torn_war_id: number | null;
  practical_finish_time: number | null;
  official_end_time: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  official_home_score: number | null;
  official_enemy_score: number | null;
};

type AttackWindowStats = {
  matching_attack_count: number;
  first_attack_started: number | null;
  last_attack_started: number | null;
};

type ExistingAttackRow = {
  id: number;
  war_id: number | null;
};

export async function getLatestIngestionRun(env: Env): Promise<Response> {
  const run = await env.DB.prepare(
    `
    SELECT *
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  )
    .first()
    .catch((err: any) => {
      console.warn("Unable to read ingestion run metric:", err?.message || err);
      return null;
    });

  return json({ ok: true, run: run ?? null });
}

async function writeFinalIngestionRunMetric(env: Env, metrics: IngestionRunMetrics): Promise<void> {
  if (!(await shouldWriteFinalIngestionRunMetric(env, metrics))) {
    return;
  }

  await env.DB.prepare(
    `
    INSERT INTO ingestion_runs (
      id,
      trigger_source,
      started_at,
      ranked_war_checked_at,
      attacks_fetch_finished_at,
      d1_writes_finished_at,
      stats_finished_at,
      report_finished_at,
      finished_at,
      latest_attack_started,
      fetched_pages,
      fetched_attacks,
      wrote_batches,
      attack_write_statements,
      sync_state_writes,
      stat_write_operations,
      report_write_operations,
      saw_rows,
      active_war_id,
      error,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
    .bind(
      metrics.id,
      metrics.triggerSource,
      metrics.startedAt,
      metrics.rankedWarCheckedAt,
      metrics.attacksFetchFinishedAt,
      metrics.d1WritesFinishedAt,
      metrics.statsFinishedAt,
      metrics.reportFinishedAt,
      metrics.finishedAt,
      metrics.latestAttackStarted,
      metrics.fetchedPages,
      metrics.fetchedAttacks,
      metrics.wroteBatches,
      metrics.attackWriteStatements,
      metrics.syncStateWrites,
      metrics.statWriteOperations,
      metrics.reportWriteOperations,
      boolToInt(metrics.sawRows) ?? 0,
      metrics.activeWarId,
      metrics.error,
      metrics.error ? "error" : "success",
    )
    .run()
    .catch((err: any) => {
      console.warn("Unable to write ingestion run metric:", err?.message || err);
    });
}

async function shouldWriteFinalIngestionRunMetric(
  env: Env,
  metrics: IngestionRunMetrics,
): Promise<boolean> {
  if (!isNoopCronIngestionRun(metrics)) {
    return true;
  }

  const latest = (await env.DB.prepare(
    `
    SELECT started_at
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT 1
    `,
  )
    .first()
    .catch(() => null)) as { started_at: number | null } | null;

  return Number(latest?.started_at ?? 0) <=
    metrics.startedAt - NOOP_CRON_INGESTION_METRIC_INTERVAL_SECONDS;
}

function isNoopCronIngestionRun(metrics: IngestionRunMetrics): boolean {
  return (
    metrics.triggerSource === "cron" &&
    metrics.error === null &&
    metrics.attackWriteStatements === 0 &&
    metrics.syncStateWrites === 0 &&
    metrics.statWriteOperations === 0 &&
    metrics.reportWriteOperations === 0
  );
}

async function scanAttackWindow(
  env: Env,
  startedAt: number,
  endedAt: number,
  onPage: (attacks: TornAttack[]) => Promise<void> | void,
): Promise<AttackWindowStats> {
  let from = startedAt;
  let matchingAttackCount = 0;
  let firstAttackStarted: number | null = null;
  let lastAttackStarted: number | null = null;

  while (true) {
    const data = await fetchAttacks(env, from, endedAt);
    const attacks = normalizeAttacks(data.attacks);

    if (attacks.length === 0) {
      break;
    }

    let pageNewestStarted = from;
    let pageReachedBeyondWindow = false;
    const windowAttacks: TornAttack[] = [];

    for (const attack of attacks) {
      const attackStarted = attack.started ?? 0;
      const attackFinishedAt = attackFinishedTimestamp(attack);
      pageNewestStarted = Math.max(pageNewestStarted, attackStarted);

      if (attackStarted < startedAt) {
        continue;
      }

      if (attackStarted > endedAt) {
        pageReachedBeyondWindow = true;
        continue;
      }

      if (attackFinishedAt !== null && attackFinishedAt > endedAt) {
        continue;
      }

      matchingAttackCount += 1;
      firstAttackStarted =
        firstAttackStarted === null ? attackStarted : Math.min(firstAttackStarted, attackStarted);
      lastAttackStarted =
        lastAttackStarted === null ? attackStarted : Math.max(lastAttackStarted, attackStarted);
      windowAttacks.push(attack);
    }

    if (windowAttacks.length > 0) {
      await onPage(windowAttacks);
    }

    if (pageReachedBeyondWindow || attacks.length < LIMIT) {
      break;
    }

    from = pageNewestStarted + 1;
  }

  return {
    matching_attack_count: matchingAttackCount,
    first_attack_started: firstAttackStarted,
    last_attack_started: lastAttackStarted,
  };
}

export async function ingestHistoricalWarWindow(
  env: Env,
  warId: number,
  startedAt: number,
  endedAt: number,
): Promise<number> {
  const ingestRunId = `import:${warId}:${crypto.randomUUID()}`;
  const stats = await scanAttackWindow(env, startedAt, endedAt, async (attacks) => {
    const statements = attacks.map((attack) =>
      buildHistoricalImportStatement(env, warId, ingestRunId, attack),
    );
    if (statements.length > 0) {
      await env.DB.batch(statements);
    }
  });

  return stats.matching_attack_count;
}

export async function previewHistoricalWarWindow(
  env: Env,
  startedAt: number,
  endedAt: number,
): Promise<{
  matching_attack_count: number;
  first_attack_started: number | null;
  last_attack_started: number | null;
  sampled_attacks: Array<{
    id: number;
    started: number | null;
    attacker_name: string | null;
    attacker_faction_id: number | null;
    defender_name: string | null;
    defender_faction_id: number | null;
    result: string | null;
    respect_gain: number;
  }>;
}> {
  const sampledAttacks: Array<{
    id: number;
    started: number | null;
    attacker_name: string | null;
    attacker_faction_id: number | null;
    defender_name: string | null;
    defender_faction_id: number | null;
    result: string | null;
    respect_gain: number;
  }> = [];

  const stats = await scanAttackWindow(env, startedAt, endedAt, (attacks) => {
    for (const attack of attacks) {
      if (sampledAttacks.length < 10) {
        sampledAttacks.push({
          id: attack.id,
          started: attack.started ?? null,
          attacker_name: attack.attacker?.name ?? null,
          attacker_faction_id: attack.attacker?.faction?.id ?? null,
          defender_name: attack.defender?.name ?? null,
          defender_faction_id: attack.defender?.faction?.id ?? null,
          result: attack.result ?? null,
          respect_gain: attack.respect_gain ?? 0,
        });
      }
    }
  });

  return {
    ...stats,
    sampled_attacks: sampledAttacks,
  };
}

export async function pullAttackWindow(
  env: Env,
  startedAt: number,
  endedAt: number,
  maxReturned = 100,
): Promise<{
  matching_attack_count: number;
  first_attack_started: number | null;
  last_attack_started: number | null;
  returned_attack_count: number;
  attacks: Array<{
    id: number;
    started: number | null;
    ended: number | null;
    attacker_id: number | null;
    attacker_name: string | null;
    attacker_faction_id: number | null;
    attacker_faction_name: string | null;
    defender_id: number | null;
    defender_name: string | null;
    defender_faction_id: number | null;
    defender_faction_name: string | null;
    result: string | null;
    respect_gain: number;
    respect_loss: number;
  }>;
}> {
  const returnedLimit = Math.max(1, Math.min(maxReturned, 250));
  const attacksInWindow: Array<{
    id: number;
    started: number | null;
    ended: number | null;
    attacker_id: number | null;
    attacker_name: string | null;
    attacker_faction_id: number | null;
    attacker_faction_name: string | null;
    defender_id: number | null;
    defender_name: string | null;
    defender_faction_id: number | null;
    defender_faction_name: string | null;
    result: string | null;
    respect_gain: number;
    respect_loss: number;
  }> = [];

  const stats = await scanAttackWindow(env, startedAt, endedAt, (attacks) => {
    for (const attack of attacks) {
      if (attacksInWindow.length < returnedLimit) {
        attacksInWindow.push({
          id: attack.id,
          started: attack.started ?? null,
          ended: attack.ended ?? null,
          attacker_id: attack.attacker?.id ?? null,
          attacker_name: attack.attacker?.name ?? null,
          attacker_faction_id: attack.attacker?.faction?.id ?? null,
          attacker_faction_name: attack.attacker?.faction?.name ?? null,
          defender_id: attack.defender?.id ?? null,
          defender_name: attack.defender?.name ?? null,
          defender_faction_id: attack.defender?.faction?.id ?? null,
          defender_faction_name: attack.defender?.faction?.name ?? null,
          result: attack.result ?? null,
          respect_gain: attack.respect_gain ?? 0,
          respect_loss: attack.respect_loss ?? 0,
        });
      }
    }
  });

  return {
    ...stats,
    returned_attack_count: attacksInWindow.length,
    attacks: attacksInWindow,
  };
}

async function activateScheduledWarIfDue(env: Env): Promise<void> {
  const now = nowSeconds();

  const activeWar = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE status = 'active'
    LIMIT 1
    `,
  ).first()) as { id: number } | null;

  if (activeWar) {
    return;
  }

  const scheduledWar = (await env.DB.prepare(
    `
    SELECT id, practical_start_time
    FROM wars
    WHERE status = 'scheduled'
      AND practical_start_time <= ?
    ORDER BY practical_start_time ASC
    LIMIT 1
    `,
  )
    .bind(now)
    .first()) as { id: number; practical_start_time: number } | null;

  if (!scheduledWar) {
    return;
  }

  await startWarTracking(env, {
    warId: scheduledWar.id,
    startedAt: scheduledWar.practical_start_time,
  });
}

async function ensureState(env: Env): Promise<void> {
  const now = nowSeconds();

  await insertSyncStateIfMissing(env, SOURCE_NAME, now);
}

async function fetchAttacks(env: Env, from: number, to?: number): Promise<TornAttackResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("from", String(from));
  if (to !== undefined) {
    url.searchParams.set("to", String(to));
  }
  url.searchParams.set("limit", String(LIMIT));

  return fetchTrackedTornJson<TornAttackResponse>(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "ingestion:attacks",
    keySource: "env:TORN_API_KEY",
  }, {
    service: "Torn attacks",
  });
}

export async function ingestRecentFactionAttacks(
  env: Env,
  from: number,
  to: number = nowSeconds(),
): Promise<RecentAttackIngestionResult> {
  const ingestRunId = `recent:${crypto.randomUUID()}`;
  let nextFrom = Math.max(0, Math.floor(from));
  const cappedTo = Math.max(nextFrom, Math.floor(to));
  let fetchedPages = 0;
  let fetchedAttacks = 0;
  let insertedAttacks = 0;

  while (fetchedPages < RECENT_ATTACK_LIGHT_SYNC_PAGE_LIMIT) {
    const data = await fetchAttacks(env, nextFrom, cappedTo);
    const attacks = normalizeAttacks(data.attacks);
    fetchedPages += 1;
    fetchedAttacks += attacks.length;

    if (attacks.length === 0) {
      break;
    }

    const existingAttackRows = await readExistingAttackRows(env, attacks.map((attack) => attack.id));
    const statements: D1PreparedStatement[] = [];
    let newestStarted = nextFrom;

    for (const attack of attacks) {
      newestStarted = Math.max(newestStarted, attack.started ?? nextFrom);
      if (!existingAttackRows.has(attack.id)) {
        statements.push(buildLiveInsertStatement(env, ingestRunId, null, attack));
      }
    }

    if (statements.length > 0) {
      const results = await env.DB.batch(statements);
      insertedAttacks += results.reduce((sum, result) => sum + d1Changes(result), 0);
    }

    if (attacks.length < LIMIT || newestStarted >= cappedTo) {
      break;
    }

    nextFrom = newestStarted + 1;
  }

  return {
    fetched_pages: fetchedPages,
    fetched_attacks: fetchedAttacks,
    inserted_attacks: insertedAttacks,
    from: Math.max(0, Math.floor(from)),
    to: cappedTo,
  };
}

async function autoEndTermedWarIfLimitReached(
  env: Env,
  activeWar: ActiveWarForIngestion,
  latestRankedWar: TornRankedWar | null,
): Promise<boolean> {
  if (
    activeWar.war_type !== "termed" ||
    activeWar.auto_end_enabled !== 1 ||
    activeWar.faction_respect_limit === null ||
    activeWar.practical_finish_time !== null
  ) {
    return false;
  }

  const rankedWar = latestRankedWar ?? (await fetchLatestRankedWar(env));
  if (!rankedWar) {
    return false;
  }

  if (activeWar.torn_war_id !== null && rankedWar.id !== activeWar.torn_war_id) {
    console.warn(
      `Skipping termed auto-end check: latest Torn ranked war ${rankedWar.id} does not match active war ${activeWar.torn_war_id}`,
    );
    return false;
  }

  if (latestRankedWar === null) {
    await updateWarRankedWarScores(env, activeWar.id, activeWar.enemy_faction_id ?? null, rankedWar);
  }

  const homeFaction = rankedWar.factions?.find(
    (faction: TornRankedWarFaction) => faction.id === HOME_FACTION_ID,
  );
  if (!homeFaction || !Number.isFinite(homeFaction.score)) {
    console.warn("Skipping termed auto-end check: home faction score missing from Torn response");
    return false;
  }

  if (homeFaction.score < activeWar.faction_respect_limit) {
    return false;
  }

  const crossingAttack = await readTermedWarLimitCrossingAttack(env, activeWar);
  const finishAt = attackFinishedTimestamp(crossingAttack ?? {}) ?? nowSeconds();

  await recordTermedWarPracticalFinish(env, {
    warId: activeWar.id,
    finishAt,
    enemyFactionId: activeWar.enemy_faction_id,
    tornWarId: rankedWar.id,
    preserveExistingFinish: true,
  });
  await sendTermedWarAutoEndDiscordMessage(env, {
    currentScore: homeFaction.score,
    targetScore: activeWar.faction_respect_limit,
    finishAt,
    crossingAttack,
  });
  return true;
}

export function attackFallsWithinLiveWarWindow(
  attack: AttackTiming,
  war: WarWindowForAttackAssignment,
): boolean {
  if (attack.started == null || attack.started < war.practical_start_time) {
    return false;
  }

  const attackFinishedAt = attackFinishedTimestamp(attack);
  if (attackFinishedAt === null) {
    return false;
  }

  if (war.practical_finish_time !== null && attackFinishedAt > war.practical_finish_time) {
    return false;
  }

  if (war.official_end_time !== null && attackFinishedAt > war.official_end_time) {
    return false;
  }

  return true;
}

export function findTermedWarLimitCrossingAttackTime(
  rows: TermedWarCrossingAttackRow[],
  factionRespectLimit: number,
): number | null {
  const attack = findTermedWarLimitCrossingAttack(rows, factionRespectLimit);

  return attack ? attackFinishedTimestamp(attack) : null;
}

export function findTermedWarLimitCrossingAttack(
  rows: TermedWarCrossingAttackRow[],
  factionRespectLimit: number,
): TermedWarCrossingAttackRow | null {
  let cumulativeRespect = 0;

  for (const row of rows) {
    const attackFinishedAt = attackFinishedTimestamp(row);
    if (attackFinishedAt === null) {
      continue;
    }

    cumulativeRespect += Number(row.respect_gain ?? 0);
    if (cumulativeRespect >= factionRespectLimit) {
      return row;
    }
  }

  return null;
}

async function readTermedWarLimitCrossingAttack(
  env: Env,
  activeWar: ActiveWarForIngestion,
): Promise<TermedWarCrossingAttackRow | null> {
  if (activeWar.faction_respect_limit === null || activeWar.enemy_faction_id === null) {
    return null;
  }

  const rows = ((await env.DB.prepare(
    `
    SELECT id, started, ended, attacker_name, defender_name, respect_gain
    FROM attacks
    WHERE war_id = ?
      AND attacker_faction_id = ?
      AND defender_faction_id = ?
      AND respect_gain > 0
      AND COALESCE(ended, started) IS NOT NULL
    ORDER BY COALESCE(ended, started) ASC, id ASC
    `,
  )
    .bind(activeWar.id, HOME_FACTION_ID, activeWar.enemy_faction_id)
    .all()).results ?? []) as TermedWarCrossingAttackRow[];

  return findTermedWarLimitCrossingAttack(rows, activeWar.faction_respect_limit);
}

function attackFinishedTimestamp(attack: AttackTiming): number | null {
  return attack.ended ?? attack.started ?? null;
}

export function buildTermedWarAutoEndDiscordMessage(options: {
  currentScore: number;
  targetScore: number;
  finishAt: number;
  crossingAttack: Pick<TermedWarCrossingAttackRow, "attacker_name" | "defender_name"> | null;
}): string {
  return [
    `Score limit reached: ${formatScore(options.currentScore)}/${formatScore(options.targetScore)}`,
    `Last attack: ${formatAttackPair(options.crossingAttack)}`,
    `Finish time: ${formatDiscordDateTime(options.finishAt)}`,
  ].join("\n");
}

async function sendTermedWarAutoEndDiscordMessage(
  env: Env,
  options: {
    currentScore: number;
    targetScore: number;
    finishAt: number;
    crossingAttack: TermedWarCrossingAttackRow | null;
  },
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) {
    return;
  }

  try {
    await sendDiscordMessage(env, buildTermedWarAutoEndDiscordMessage(options));
  } catch (err: any) {
    console.warn("Unable to send termed war auto-end Discord message:", err?.message || err);
  }
}

function formatAttackPair(
  attack: Pick<TermedWarCrossingAttackRow, "attacker_name" | "defender_name"> | null,
): string {
  const attacker = cleanDiscordLineText(attack?.attacker_name) ?? "Unknown attacker";
  const defender = cleanDiscordLineText(attack?.defender_name) ?? "Unknown defender";

  return `${attacker} v ${defender}`;
}

function formatScore(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}

function formatDiscordDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDate();
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);

  return `${day}${ordinalSuffix(day)} ${month} ${date.getUTCFullYear()} ${time} UTC`;
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) {
    return "th";
  }

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function cleanDiscordLineText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();

  return cleaned || null;
}

async function syncRankedWarScores(
  env: Env,
  activeWar: ActiveWarForIngestion,
  rankedWar: TornRankedWar,
): Promise<void> {
  if (activeWar.war_type === "event") {
    return;
  }

  if (!rankedWarMatchesActiveWar(activeWar, rankedWar)) {
    return;
  }

  const scores = getRankedWarScores(activeWar.enemy_faction_id ?? null, rankedWar);
  if (
    activeWar.torn_war_id === rankedWar.id &&
    activeWar.enemy_faction_id === (scores.enemyFaction?.id ?? activeWar.enemy_faction_id) &&
    activeWar.official_home_score === (scores.homeFaction?.score ?? null) &&
    activeWar.official_enemy_score === (scores.enemyFaction?.score ?? null)
  ) {
    return;
  }

  await updateWarRankedWarScores(env, activeWar.id, activeWar.enemy_faction_id ?? null, rankedWar);
}

async function syncActiveWarOfficialEnd(
  env: Env,
  activeWar: ActiveWarForIngestion,
  latestRankedWar: TornRankedWar,
): Promise<number | null> {
  if (latestRankedWar.end <= 0) {
    return null;
  }

  if (activeWar.war_type === "event") {
    return null;
  }

  if (!rankedWarMatchesActiveWar(activeWar, latestRankedWar)) {
    return null;
  }

  const officialEndTime = latestRankedWar.end;
  const scores = getRankedWarScores(activeWar.enemy_faction_id ?? null, latestRankedWar);

  await applyTornOfficialWarEnd(env, {
    warId: activeWar.id,
    officialEndTime,
    tornWarId: latestRankedWar.id,
    currentEnemyFactionId: activeWar.enemy_faction_id,
    enemyFactionId: scores.enemyFaction?.id ?? null,
    homeScore: scores.homeFaction?.score ?? null,
    enemyScore: scores.enemyFaction?.score ?? null,
    winnerFactionId: latestRankedWar.winner ?? null,
  });

  return officialEndTime;
}

async function syncUnfinishedRankedWar(env: Env, rankedWar: TornRankedWar): Promise<void> {
  const war = (await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      status,
      war_type,
      enemy_faction_id,
      torn_war_id,
      practical_finish_time,
      official_end_time,
      auto_end_enabled,
      faction_respect_limit
    FROM wars
    WHERE torn_war_id = ?
      AND official_end_time IS NULL
      AND COALESCE(war_type, 'real') != 'event'
    ORDER BY practical_start_time DESC
    LIMIT 1
    `,
  )
    .bind(rankedWar.id)
    .first()) as ActiveWarForIngestion | null;

  if (!war) {
    return;
  }

  if (rankedWar.end > 0) {
    await syncActiveWarOfficialEnd(env, war, rankedWar);
    return;
  }

  await updateWarRankedWarScores(env, war.id, war.enemy_faction_id, rankedWar);
}

export async function syncMissingRankedWarReports(env: Env): Promise<{
  checked: number;
  fetched: number;
  writeOperations: number;
}> {
  const rows = await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      status,
      war_type,
      enemy_faction_id,
      torn_war_id,
      practical_finish_time,
      official_end_time,
      auto_end_enabled,
      faction_respect_limit
    FROM wars
    WHERE torn_war_id IS NOT NULL
      AND status = 'ended'
      AND official_end_time IS NOT NULL
      AND torn_report_fetched_at IS NULL
      AND COALESCE(war_type, 'real') != 'event'
    ORDER BY official_end_time DESC, practical_start_time DESC
    LIMIT 3
    `,
  )
    .all();

  let fetched = 0;
  for (const war of (rows.results ?? []) as ActiveWarForIngestion[]) {
    if (await fetchAndApplyRankedWarReport(env, war, war.torn_war_id)) {
      fetched += 1;
    }
  }

  return {
    checked: (rows.results ?? []).length,
    fetched,
    writeOperations: fetched,
  };
}

async function fetchAndApplyRankedWarReport(
  env: Env,
  war: ActiveWarForIngestion,
  rankedWarId: number | null,
): Promise<boolean> {
  if (rankedWarId === null) {
    return false;
  }

  try {
    const report = await fetchTornRankedWarReport(rankedWarId, env);
    if (!report) {
      console.warn(`Torn ranked war report ${rankedWarId} was not available yet`);
      return false;
    }

    await applyRankedWarReport(env, war.id, war.name, war.enemy_faction_id, rankedWarId, report);
    return true;
  } catch (err: any) {
    console.error(`Torn ranked war report ${rankedWarId} fetch failed:`, err?.message || err);
    return false;
  }
}

async function syncUpcomingRankedWar(
  env: Env,
  rankedWar: TornRankedWar | null,
): Promise<void> {
  const now = nowSeconds();
  if (!rankedWar || rankedWar.start <= now || rankedWar.end !== 0) {
    return;
  }

  const homeFaction = rankedWar.factions?.find(
    (faction: TornRankedWarFaction) => faction.id === HOME_FACTION_ID,
  );
  const enemyFaction = rankedWar.factions?.find(
    (faction: TornRankedWarFaction) => faction.id !== HOME_FACTION_ID,
  );

  if (!homeFaction || !enemyFaction) {
    console.warn("Skipping ranked war schedule sync: expected factions missing from Torn response");
    return;
  }

  const existingByTornId = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE torn_war_id = ?
    LIMIT 1
    `,
  )
    .bind(rankedWar.id)
    .first()) as { id: number } | null;

  if (existingByTornId) {
    await updateWarRankedWarScores(env, existingByTornId.id, enemyFaction.id, rankedWar, rankedWar.start);
    return;
  }

  const existingScheduledWar = (await env.DB.prepare(
    `
    SELECT id
    FROM wars
    WHERE status = 'scheduled'
    LIMIT 1
    `,
  ).first()) as { id: number } | null;

  if (existingScheduledWar) {
    console.warn(
      `Skipping ranked war schedule sync: scheduled war already exists and Torn war ${rankedWar.id} is not linked`,
    );
    return;
  }

  const name = await buildScheduledRankedWarName(env, enemyFaction.name);

  const inserted = (await env.DB.prepare(
    `
    INSERT INTO wars (
      name,
      status,
      practical_start_time,
      official_start_time,
      enemy_faction_id,
      war_type,
      torn_war_id,
      official_home_score,
      official_enemy_score
    )
    VALUES (?, 'scheduled', ?, ?, ?, 'real', ?, ?, ?)
    RETURNING id
    `,
  )
    .bind(
      name,
      rankedWar.start,
      rankedWar.start,
      enemyFaction.id,
      rankedWar.id,
      homeFaction.score,
      enemyFaction.score,
    )
    .first()) as { id: number } | null;

  if (inserted) {
    await fetchEnemyScoutingOnceForWar(env, inserted.id);
  }
}

function getRankedWarScores(factionId: number | null, rankedWar: TornRankedWar): {
  homeFaction: TornRankedWarFaction | null;
  enemyFaction: TornRankedWarFaction | null;
} {
  const factions = rankedWar.factions ?? [];
  const homeFaction = factions.find((faction) => faction.id === HOME_FACTION_ID) ?? null;
  const enemyFaction =
    factions.find((faction) => factionId !== null && faction.id === factionId) ??
    factions.find((faction) => faction.id !== HOME_FACTION_ID) ??
    null;

  return { homeFaction, enemyFaction };
}

function rankedWarMatchesActiveWar(
  activeWar: ActiveWarForIngestion,
  rankedWar: TornRankedWar,
): boolean {
  if (activeWar.torn_war_id !== null) {
    return rankedWar.id === activeWar.torn_war_id;
  }

  return rankedWar.start >= activeWar.practical_start_time;
}

async function updateWarRankedWarScores(
  env: Env,
  warId: number,
  factionId: number | null,
  rankedWar: TornRankedWar,
  startTime?: number,
): Promise<void> {
  const { homeFaction, enemyFaction } = getRankedWarScores(factionId, rankedWar);

  if (!homeFaction) {
    console.warn("Skipping ranked war score sync: home faction score missing from Torn response");
    return;
  }

  await env.DB.prepare(
    `
    UPDATE wars
    SET practical_start_time = COALESCE(?, practical_start_time),
        official_start_time = COALESCE(official_start_time, ?),
        enemy_faction_id = COALESCE(?, enemy_faction_id),
        torn_war_id = COALESCE(torn_war_id, ?),
        official_home_score = ?,
        official_enemy_score = ?
    WHERE id = ?
    `,
  )
    .bind(
      startTime ?? null,
      rankedWar.start ?? null,
      enemyFaction?.id ?? null,
      rankedWar.id,
      homeFaction.score,
      enemyFaction?.score ?? null,
      warId,
    )
    .run();
}

async function buildScheduledRankedWarName(env: Env, enemyFactionName: string): Promise<string> {
  const baseName = enemyFactionName
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 50) || "Ranked war";

  let candidate = baseName;
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const existing = await env.DB.prepare(
      `
      SELECT id
      FROM wars
      WHERE LOWER(name) = LOWER(?)
      LIMIT 1
      `,
    )
      .bind(candidate)
      .first();

    if (!existing) {
      return candidate;
    }

    const suffixText = ` ${suffix + 1}`;
    candidate = `${baseName.slice(0, 50 - suffixText.length)}${suffixText}`;
  }

  return `${baseName.slice(0, 39)} ${nowSeconds()}`;
}

async function fetchLatestRankedWar(env: Env): Promise<TornRankedWar | null> {
  const url = new URL(RANKED_WARS_API_URL);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "1");
  url.searchParams.set("sort", "DESC");

  const data = await fetchTrackedTornJson<TornRankedWarResponse>(env, url, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  }, {
    feature: "ingestion:rankedwars",
    keySource: "env:TORN_API_KEY",
  }, {
    service: "Torn ranked wars",
  });

  return data.rankedwars?.[0] ?? null;
}

async function readExistingAttackRows(
  env: Env,
  attackIds: number[],
): Promise<Map<number, ExistingAttackRow>> {
  const uniqueIds = Array.from(new Set(attackIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = ((await env.DB.prepare(
    `
    SELECT id, war_id
    FROM attacks
    WHERE id IN (${uniqueIds.map(() => "?").join(",")})
    `,
  )
    .bind(...uniqueIds)
    .all()).results ?? []) as ExistingAttackRow[];

  return new Map(rows.map((row) => [row.id, row]));
}

function buildLiveWarAssignmentStatement(
  env: Env,
  ingestRunId: string,
  warId: number,
  attackId: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = ?,
        ingest_run_id = ?,
        fetched_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND war_id IS NULL
    `,
  ).bind(warId, ingestRunId, attackId);
}

function buildLiveInsertStatement(
  env: Env,
  ingestRunId: string,
  warId: number | null,
  attack: TornAttack,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO attacks (
      id,
      war_id,
      code,
      started,
      ended,
      attacker_id,
      attacker_name,
      attacker_level,
      attacker_faction_id,
      attacker_faction_name,
      defender_id,
      defender_name,
      defender_level,
      defender_faction_id,
      defender_faction_name,
      result,
      respect_gain,
      respect_loss,
      chain,
      is_interrupted,
      is_stealthed,
      is_raid,
      is_ranked_war,
      m_fair_fight,
      m_war,
      m_retaliation,
      m_group,
      m_overseas,
      m_chain,
      m_warlord,
      ingest_run_id,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO NOTHING
    `,
  ).bind(
    attack.id,
    warId,
    attack.code ?? null,
    attack.started ?? null,
    attack.ended ?? null,
    attack.attacker?.id ?? null,
    attack.attacker?.name ?? null,
    attack.attacker?.level ?? null,
    attack.attacker?.faction?.id ?? null,
    attack.attacker?.faction?.name ?? null,
    attack.defender?.id ?? null,
    attack.defender?.name ?? null,
    attack.defender?.level ?? null,
    attack.defender?.faction?.id ?? null,
    attack.defender?.faction?.name ?? null,
    attack.result ?? null,
    attack.respect_gain ?? 0,
    attack.respect_loss ?? 0,
    attack.chain ?? null,
    boolToInt(attack.is_interrupted),
    boolToInt(attack.is_stealthed),
    boolToInt(attack.is_raid),
    boolToInt(attack.is_ranked_war),
    attack.modifiers?.fair_fight ?? 1,
    attack.modifiers?.war ?? 1,
    attack.modifiers?.retaliation ?? 1,
    attack.modifiers?.group ?? 1,
    attack.modifiers?.overseas ?? 1,
    attack.modifiers?.chain ?? 1,
    attack.modifiers?.warlord ?? 1,
    ingestRunId,
  );
}

function buildHistoricalImportStatement(
  env: Env,
  warId: number,
  ingestRunId: string,
  attack: TornAttack,
): D1PreparedStatement {
  return env.DB.prepare(
    `
    INSERT INTO attacks (
      id,
      war_id,
      code,
      started,
      ended,
      attacker_id,
      attacker_name,
      attacker_level,
      attacker_faction_id,
      attacker_faction_name,
      defender_id,
      defender_name,
      defender_level,
      defender_faction_id,
      defender_faction_name,
      result,
      respect_gain,
      respect_loss,
      chain,
      is_interrupted,
      is_stealthed,
      is_raid,
      is_ranked_war,
      m_fair_fight,
      m_war,
      m_retaliation,
      m_group,
      m_overseas,
      m_chain,
      m_warlord,
      ingest_run_id,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      war_id = COALESCE(attacks.war_id, excluded.war_id)
    `,
  ).bind(
    attack.id,
    warId,
    attack.code ?? null,
    attack.started ?? null,
    attack.ended ?? null,
    attack.attacker?.id ?? null,
    attack.attacker?.name ?? null,
    attack.attacker?.level ?? null,
    attack.attacker?.faction?.id ?? null,
    attack.attacker?.faction?.name ?? null,
    attack.defender?.id ?? null,
    attack.defender?.name ?? null,
    attack.defender?.level ?? null,
    attack.defender?.faction?.id ?? null,
    attack.defender?.faction?.name ?? null,
    attack.result ?? null,
    attack.respect_gain ?? 0,
    attack.respect_loss ?? 0,
    attack.chain ?? null,
    boolToInt(attack.is_interrupted),
    boolToInt(attack.is_stealthed),
    boolToInt(attack.is_raid),
    boolToInt(attack.is_ranked_war),
    attack.modifiers?.fair_fight ?? 1,
    attack.modifiers?.war ?? 1,
    attack.modifiers?.retaliation ?? 1,
    attack.modifiers?.group ?? 1,
    attack.modifiers?.overseas ?? 1,
    attack.modifiers?.chain ?? 1,
    attack.modifiers?.warlord ?? 1,
    ingestRunId,
  );
}

