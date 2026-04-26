import {
  API_URL,
  HOME_FACTION_ID,
  LIMIT,
  OVERLAP_SECONDS,
  RANKED_WARS_API_URL,
  SOURCE_NAME,
} from "./constants";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw, applyIncrementalWarSummaries } from "./summaries";
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
          start_time,
          status,
          war_type,
          torn_war_id,
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
        activeWar && attack.started != null && attack.started >= activeWar.start_time
          ? activeWar.id
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

  if (sawAnyRows && activeWar) {
    await applyIncrementalWarSummaries(env, activeWar.id, ingestRunId);
  }

  if (activeWar) {
    await autoEndTermedWarIfLimitReached(env, activeWar, latestRankedWar);
  }
}

type ActiveWarForIngestion = {
  id: number;
  start_time: number;
  status: string;
  war_type: string | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
};

export async function ingestHistoricalWarWindow(
  env: Env,
  warId: number,
  startedAt: number,
  endedAt: number,
): Promise<number> {
  const ingestRunId = `import:${warId}:${crypto.randomUUID()}`;
  let from = startedAt;
  let importedCount = 0;

  while (true) {
    const data = await fetchAttacks(env, from, endedAt);
    const attacks = normalizeAttacks(data.attacks);

    if (attacks.length === 0) {
      break;
    }

    const statements: D1PreparedStatement[] = [];
    let pageNewestStarted = from;
    let pageReachedBeyondWindow = false;

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

      importedCount += 1;
      statements.push(buildHistoricalImportStatement(env, warId, ingestRunId, attack));
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    if (pageReachedBeyondWindow || attacks.length < LIMIT) {
      break;
    }

    from = pageNewestStarted + 1;
  }

  return importedCount;
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
  let from = startedAt;
  let matchingAttackCount = 0;
  let firstAttackStarted: number | null = null;
  let lastAttackStarted: number | null = null;
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

  while (true) {
    const data = await fetchAttacks(env, from, endedAt);
    const attacks = normalizeAttacks(data.attacks);

    if (attacks.length === 0) {
      break;
    }

    let pageNewestStarted = from;
    let pageReachedBeyondWindow = false;

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

    if (pageReachedBeyondWindow || attacks.length < LIMIT) {
      break;
    }

    from = pageNewestStarted + 1;
  }

  return {
    matching_attack_count: matchingAttackCount,
    first_attack_started: firstAttackStarted,
    last_attack_started: lastAttackStarted,
    sampled_attacks: sampledAttacks,
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
    SELECT id, start_time
    FROM wars
    WHERE status = 'scheduled'
      AND start_time <= ?
    ORDER BY start_time ASC
    LIMIT 1
    `,
  )
    .bind(now)
    .first()) as { id: number; start_time: number } | null;

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

  await setActiveWarState(env, scheduledWar.id, scheduledWar.start_time);
  await backfillWarAssignments(env, scheduledWar.id, scheduledWar.start_time);
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

  const checkedAt = nowSeconds();

  await env.DB.prepare(
    `
    UPDATE wars
    SET last_respect_check_at = ?,
        last_observed_respect = ?,
        torn_war_id = COALESCE(torn_war_id, ?)
    WHERE id = ?
    `,
  )
    .bind(checkedAt, homeFaction.score, rankedWar.id, activeWar.id)
    .run();

  if (homeFaction.score < activeWar.faction_respect_limit) {
    return;
  }

  await env.DB.prepare(
    `
    UPDATE wars
    SET status = 'ended',
        finish_time = ?,
        last_respect_check_at = ?,
        last_observed_respect = ?,
        torn_war_id = COALESCE(torn_war_id, ?)
    WHERE id = ?
      AND status = 'active'
    `,
  )
    .bind(checkedAt, checkedAt, homeFaction.score, rankedWar.id, activeWar.id)
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

  await finalizeWar(env, activeWar.id);
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
    await env.DB.prepare(
      `
      UPDATE wars
      SET start_time = ?,
          faction_id = ?,
          last_respect_check_at = ?,
          last_observed_respect = ?
      WHERE id = ?
      `,
    )
      .bind(rankedWar.start, enemyFaction.id, now, homeFaction.score, existingByTornId.id)
      .run();
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

  const name = buildScheduledRankedWarName(enemyFaction.name, rankedWar.id);

  await env.DB.prepare(
    `
    INSERT INTO wars (
      name,
      status,
      start_time,
      faction_id,
      war_type,
      torn_war_id,
      last_respect_check_at,
      last_observed_respect
    )
    VALUES (?, 'scheduled', ?, ?, 'real', ?, ?, ?)
    `,
  )
    .bind(name, rankedWar.start, enemyFaction.id, rankedWar.id, now, homeFaction.score)
    .run();
}

function buildScheduledRankedWarName(enemyFactionName: string, tornWarId: number): string {
  const baseName = `rw-${enemyFactionName}-${tornWarId}`
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 50);

  return baseName || `ranked-war-${tornWarId}`;
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
