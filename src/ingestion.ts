import {
  API_URL,
  HOME_FACTION_ID,
  LIMIT,
  OVERLAP_SECONDS,
  RANKED_WARS_API_URL,
  SOURCE_NAME,
} from "./constants";
import { fetchEnemyScoutingOnceForWar } from "./enemyScouting";
import { clearEnemyHeatmapForFaction, sampleFactionActivityHeatmaps } from "./heatmap";
import { applyRankedWarReport, fetchTornRankedWarReport } from "./reports";
import {
  applyIncrementalWarSummaries,
  finalizeWar,
  rebuildWarMemberStatsFromRaw,
  rebuildWarSummaryFromRaw,
} from "./summaries";
import {
  D1PreparedStatement,
  Env,
  TornAttack,
  TornAttackResponse,
  TornRankedWar,
  TornRankedWarFaction,
  TornRankedWarResponse,
} from "./types";
import { boolToInt, normalizeAttacks, nowSeconds } from "./utils";

export async function runIngestion(env: Env): Promise<void> {
  try {
    await ensureState(env);
    const latestRankedWar = await fetchLatestRankedWar(env).catch((err) => {
      console.error("Torn ranked wars sync failed:", err?.message || err);
      return null;
    });
    await syncUpcomingRankedWar(env, latestRankedWar);
    await activateScheduledWarIfDue(env);

    const state = (await env.DB.prepare(
      `
      SELECT last_started, active_war_id
      FROM sync_state
      WHERE name = ?
      `,
    )
      .bind(SOURCE_NAME)
      .first()) as {
      last_started: number;
      active_war_id: number | null;
    } | null;

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
            faction_respect_limit
          FROM wars
          WHERE id = ? AND status = 'active'
          LIMIT 1
          `,
        )
          .bind(state.active_war_id)
          .first()) as ActiveWarForIngestion | null)
      : null;
    const officialEndTime =
      activeWar && latestRankedWar ? await syncActiveWarOfficialEnd(env, activeWar, latestRankedWar) : null;
    if (activeWar && latestRankedWar && officialEndTime === null) {
      await syncRankedWarScores(env, activeWar, latestRankedWar);
    }
    if (!activeWar && latestRankedWar) {
      await syncUnfinishedRankedWar(env, latestRankedWar);
    }
    if (!activeWar) {
      await syncMissingRankedWarReports(env);
    }
    const ingestionWar = activeWar
      ? {
          ...activeWar,
          official_end_time: officialEndTime ?? activeWar.official_end_time,
        }
      : null;

    let from = Math.max(0, (state?.last_started ?? 0) - OVERLAP_SECONDS);
    let newestStarted = state?.last_started ?? 0;
    const ingestRunId = crypto.randomUUID();
    let sawAnyRows = false;

    while (true) {
      const data = await fetchAttacks(env, from);
      const attacks = normalizeAttacks(data.attacks);

      if (attacks.length === 0) {
        break;
      }

      sawAnyRows = true;
      const statements: D1PreparedStatement[] = [];
      let pageNewestStarted = newestStarted;

      for (const attack of attacks) {
        pageNewestStarted = Math.max(pageNewestStarted, attack.started ?? 0);

        const warId =
          ingestionWar &&
          attack.started != null &&
          attack.started >= ingestionWar.practical_start_time &&
          (ingestionWar.official_end_time === null || attack.started <= ingestionWar.official_end_time)
            ? ingestionWar.id
            : null;

        statements.push(buildLiveInsertStatement(env, ingestRunId, warId, attack));
      }

      if (statements.length > 0) {
        await env.DB.batch(statements);
      }

      newestStarted = pageNewestStarted;

      await env.DB.prepare(
        `
        INSERT INTO sync_state (name, last_started, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(name) DO UPDATE SET
          last_started = excluded.last_started,
          updated_at = CURRENT_TIMESTAMP
        `,
      )
        .bind(SOURCE_NAME, newestStarted)
        .run();

      if (attacks.length < LIMIT) {
        break;
      }

      from = newestStarted;
    }

    if (sawAnyRows && ingestionWar) {
      await applyIncrementalWarSummaries(env, ingestionWar.id, ingestRunId);
    }

    if (ingestionWar && officialEndTime !== null) {
      await fetchAndApplyRankedWarReport(env, ingestionWar, latestRankedWar?.id ?? ingestionWar.torn_war_id);
      await finalizeWar(env, ingestionWar.id);
      return;
    }

    if (ingestionWar) {
      await autoEndTermedWarIfLimitReached(env, ingestionWar, latestRankedWar);
    }
  } finally {
    await sampleFactionActivityHeatmaps(env).catch((err) => {
      console.error("Faction activity heatmap sampling failed:", err?.message || err);
    });
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
};

type AttackWindowStats = {
  matching_attack_count: number;
  first_attack_started: number | null;
  last_attack_started: number | null;
};

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
      pageNewestStarted = Math.max(pageNewestStarted, attackStarted);

      if (attackStarted < startedAt) {
        continue;
      }

      if (attackStarted > endedAt) {
        pageReachedBeyondWindow = true;
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

export async function activateScheduledWarIfDue(env: Env): Promise<void> {
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

  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'active'
    WHERE id = ?
    `,
  )
    .bind(scheduledWar.id)
    .run();

  await setActiveWarState(env, scheduledWar.id, scheduledWar.practical_start_time);
  await backfillWarAssignments(env, scheduledWar.id, scheduledWar.practical_start_time);
  await rebuildWarSummaryFromRaw(env, scheduledWar.id);
  await rebuildWarMemberStatsFromRaw(env, scheduledWar.id);
}

export async function setActiveWarState(
  env: Env,
  warId: number,
  startedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      active_war_id = excluded.active_war_id,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(SOURCE_NAME, startedAt, warId)
    .run();
}

export async function backfillWarAssignments(
  env: Env,
  warId: number,
  startedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE attacks
    SET war_id = ?
    WHERE war_id IS NULL
      AND started >= ?
      AND (
        attacker_faction_id = ?
        OR defender_faction_id = ?
      )
    `,
  )
    .bind(warId, startedAt, HOME_FACTION_ID, HOME_FACTION_ID)
    .run();
}

async function ensureState(env: Env): Promise<void> {
  const now = nowSeconds();

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO NOTHING
    `,
  )
    .bind(SOURCE_NAME, now)
    .run();
}

async function fetchAttacks(env: Env, from: number, to?: number): Promise<TornAttackResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("from", String(from));
  if (to !== undefined) {
    url.searchParams.set("to", String(to));
  }
  url.searchParams.set("limit", String(LIMIT));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn API error: ${response.status}`);
  }

  return response.json();
}

async function autoEndTermedWarIfLimitReached(
  env: Env,
  activeWar: ActiveWarForIngestion,
  latestRankedWar: TornRankedWar | null,
): Promise<void> {
  if (
    activeWar.war_type !== "termed" ||
    activeWar.auto_end_enabled !== 1 ||
    activeWar.faction_respect_limit === null
  ) {
    return;
  }

  const rankedWar = latestRankedWar ?? (await fetchLatestRankedWar(env));
  if (!rankedWar) {
    return;
  }

  if (activeWar.torn_war_id !== null && rankedWar.id !== activeWar.torn_war_id) {
    console.warn(
      `Skipping termed auto-end check: latest Torn ranked war ${rankedWar.id} does not match active war ${activeWar.torn_war_id}`,
    );
    return;
  }

  const homeFaction = rankedWar.factions?.find(
    (faction: TornRankedWarFaction) => faction.id === HOME_FACTION_ID,
  );
  if (!homeFaction || !Number.isFinite(homeFaction.score)) {
    console.warn("Skipping termed auto-end check: home faction score missing from Torn response");
    return;
  }

  await updateWarRankedWarScores(env, activeWar.id, activeWar.enemy_faction_id, rankedWar);

  if (homeFaction.score < activeWar.faction_respect_limit) {
    return;
  }

  const checkedAt = nowSeconds();
  await env.DB.prepare(
    `
    UPDATE wars
    SET practical_finish_time = COALESCE(practical_finish_time, ?),
        torn_war_id = COALESCE(torn_war_id, ?)
    WHERE id = ?
    `,
  )
    .bind(checkedAt, rankedWar.id, activeWar.id)
    .run();

  await rebuildWarSummaryFromRaw(env, activeWar.id);
  await rebuildWarMemberStatsFromRaw(env, activeWar.id);
}

async function syncRankedWarScores(
  env: Env,
  activeWar: ActiveWarForIngestion,
  rankedWar: TornRankedWar,
): Promise<void> {
  if (activeWar.war_type === "other") {
    return;
  }

  if (!rankedWarMatchesActiveWar(activeWar, rankedWar)) {
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

  if (activeWar.war_type === "other") {
    return null;
  }

  if (!rankedWarMatchesActiveWar(activeWar, latestRankedWar)) {
    return null;
  }

  const officialEndTime = latestRankedWar.end;
  const scores = getRankedWarScores(activeWar.enemy_faction_id ?? null, latestRankedWar);

  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'ended',
        official_end_time = ?,
        practical_finish_time = COALESCE(practical_finish_time, ?),
        torn_war_id = COALESCE(torn_war_id, ?),
        enemy_faction_id = COALESCE(?, enemy_faction_id),
        official_home_score = ?,
        official_enemy_score = ?,
        winner_faction_id = COALESCE(?, winner_faction_id)
    WHERE id = ?
    `,
  )
    .bind(
      officialEndTime,
      officialEndTime,
      latestRankedWar.id,
      scores.enemyFaction?.id ?? null,
      scores.homeFaction?.score ?? null,
      scores.enemyFaction?.score ?? null,
      latestRankedWar.winner ?? null,
      activeWar.id,
    )
    .run();

  await env.DB.prepare(
    `
    UPDATE sync_state
    SET active_war_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
    `,
  )
    .bind(SOURCE_NAME)
    .run();

  await clearEnemyHeatmapForFaction(env, scores.enemyFaction?.id ?? activeWar.enemy_faction_id ?? null);

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
      AND COALESCE(war_type, 'real') != 'other'
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

async function syncMissingRankedWarReports(env: Env): Promise<void> {
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
      AND COALESCE(war_type, 'real') != 'other'
    ORDER BY official_end_time DESC, practical_start_time DESC
    LIMIT 3
    `,
  )
    .all();

  for (const war of (rows.results ?? []) as ActiveWarForIngestion[]) {
    await fetchAndApplyRankedWarReport(env, war, war.torn_war_id);
  }
}

async function fetchAndApplyRankedWarReport(
  env: Env,
  war: ActiveWarForIngestion,
  rankedWarId: number | null,
): Promise<void> {
  if (rankedWarId === null) {
    return;
  }

  try {
    const report = await fetchTornRankedWarReport(rankedWarId, env);
    if (!report) {
      console.warn(`Torn ranked war report ${rankedWarId} was not available yet`);
      return;
    }

    await applyRankedWarReport(env, war.id, war.name, war.enemy_faction_id, rankedWarId, report);
  } catch (err: any) {
    console.error(`Torn ranked war report ${rankedWarId} fetch failed:`, err?.message || err);
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

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${env.TORN_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Torn ranked wars API error: ${response.status}`);
  }

  const data = (await response.json()) as TornRankedWarResponse;
  return data.rankedwars?.[0] ?? null;
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
