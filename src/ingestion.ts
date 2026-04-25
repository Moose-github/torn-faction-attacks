import {
  API_URL,
  HOME_FACTION_ID,
  LIMIT,
  OVERLAP_SECONDS,
  SOURCE_NAME,
} from "./constants";
import { finalizeWar, rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw, applyIncrementalWarSummaries } from "./summaries";
import { D1PreparedStatement, Env, TornAttack, TornAttackResponse } from "./types";
import { boolToInt, normalizeAttacks, nowSeconds } from "./utils";

export async function runIngestion(env: Env): Promise<void> {
  await ensureState(env);
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
        SELECT id, started_at, status
        FROM wars
        WHERE id = ? AND status = 'active'
        LIMIT 1
        `,
      )
        .bind(state.active_war_id)
        .first()) as { id: number; started_at: number; status: string } | null)
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
        activeWar && attack.started != null && attack.started >= activeWar.started_at
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
}

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
    const data = await fetchAttacks(env, from);
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
    SELECT id, started_at
    FROM wars
    WHERE status = 'scheduled'
      AND started_at <= ?
    ORDER BY started_at ASC
    LIMIT 1
    `,
  )
    .bind(now)
    .first()) as { id: number; started_at: number } | null;

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

  await setActiveWarState(env, scheduledWar.id, scheduledWar.started_at);
  await backfillWarAssignments(env, scheduledWar.id, scheduledWar.started_at);
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

async function fetchAttacks(env: Env, from: number): Promise<TornAttackResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("sort", "ASC");
  url.searchParams.set("from", String(from));
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
