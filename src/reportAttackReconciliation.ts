import { API_URL, HOME_FACTION_ID, POSITIVE_ATTACK_RESULTS } from "./constants";
import { fetchTrackedTornJson } from "./external/torn";
import { withTornKeyPool } from "./tornKeyPool";
import type { Env, TornAttack, TornAttackResponse } from "./types";
import { boolToInt, normalizeAttacks } from "./utils";

const TORN_ATTACK_PAGE_LIMIT = 100;
const MAX_TORN_ATTACK_PAGES = 40;
const FETCH_WINDOW_BUFFER_SECONDS = 60;
const LOCAL_ATTACK_QUERY_CHUNK_SIZE = 80;
const INSERT_ITEM_CHUNK_SIZE = 50;
const RESPECT_TOLERANCE = 0.01;

const POSITIVE_ATTACK_RESULT_SET = new Set<string>(POSITIVE_ATTACK_RESULTS);

export type ReportAttackReconciliationMismatch = {
  member_id: number;
  member_name: string | null;
  attack_diff: number;
};

export type ReportAttackReconciliationWar = {
  id: number;
  name: string;
  torn_report_fetched_at: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
  enemy_faction_id: number | null;
};

export type ReportAttackReconciliationResult = {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  run_id?: number;
  member_ids?: number[];
  torn_attacks_fetched?: number;
  comparable_torn_attacks?: number;
  local_attacks_checked?: number;
  findings_count?: number;
  truncated?: boolean;
  error?: string;
};

export type ReportAttackReconciliationItem = {
  id: number;
  run_id: number;
  war_id: number;
  member_id: number;
  member_name: string | null;
  attack_id: number | null;
  attack_code: string | null;
  source: "torn" | "local" | "both";
  classification: string;
  reason: string;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number | null;
  chain: number | null;
  local_war_id: number | null;
  local_included: number | null;
  torn_included: number | null;
};

export type ReportAttackReconciliationDetails = {
  id: number;
  war_id: number;
  torn_report_fetched_at: number | null;
  official_start_time: number;
  official_end_time: number;
  member_ids: number[];
  status: "running" | "completed" | "failed";
  torn_attacks_fetched: number;
  comparable_torn_attacks: number;
  local_attacks_checked: number;
  findings_count: number;
  truncated: number;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  items: ReportAttackReconciliationItem[];
};

type LocalAttackRow = {
  id: number;
  war_id: number | null;
  code: string | null;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  attacker_faction_id: number | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number | null;
  chain: number | null;
};

type ReconciliationFinding = {
  warId: number;
  memberId: number;
  memberName: string | null;
  attackId: number | null;
  attackCode: string | null;
  source: "torn" | "local" | "both";
  classification: string;
  reason: string;
  started: number | null;
  ended: number | null;
  attackerId: number | null;
  attackerName: string | null;
  defenderId: number | null;
  defenderName: string | null;
  defenderFactionId: number | null;
  defenderFactionName: string | null;
  result: string | null;
  respectGain: number | null;
  chain: number | null;
  localWarId: number | null;
  localIncluded: boolean | null;
  tornIncluded: boolean | null;
};

export async function getLatestWarReportAttackReconciliation(
  env: Env,
  warId: number,
): Promise<ReportAttackReconciliationDetails | null> {
  const run = await env.DB.prepare(
    `
    SELECT
      id,
      war_id,
      torn_report_fetched_at,
      official_start_time,
      official_end_time,
      member_ids_json,
      status,
      torn_attacks_fetched,
      comparable_torn_attacks,
      local_attacks_checked,
      findings_count,
      truncated,
      error,
      created_at,
      completed_at
    FROM war_report_attack_reconciliation_runs
    WHERE war_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
  )
    .bind(warId)
    .first();

  if (!run) {
    return null;
  }

  const itemsResult = await env.DB.prepare(
    `
    SELECT
      id,
      run_id,
      war_id,
      member_id,
      member_name,
      attack_id,
      attack_code,
      source,
      classification,
      reason,
      started,
      ended,
      attacker_id,
      attacker_name,
      defender_id,
      defender_name,
      defender_faction_id,
      defender_faction_name,
      result,
      respect_gain,
      chain,
      local_war_id,
      local_included,
      torn_included
    FROM war_report_attack_reconciliation_items
    WHERE run_id = ?
    ORDER BY member_name COLLATE NOCASE ASC, member_id ASC, started ASC, id ASC
    `,
  )
    .bind((run as any).id)
    .all();

  return {
    id: Number((run as any).id),
    war_id: Number((run as any).war_id),
    torn_report_fetched_at: nullableNumber((run as any).torn_report_fetched_at),
    official_start_time: Number((run as any).official_start_time),
    official_end_time: Number((run as any).official_end_time),
    member_ids: parseMemberIds((run as any).member_ids_json),
    status: normalizeRunStatus((run as any).status),
    torn_attacks_fetched: Number((run as any).torn_attacks_fetched ?? 0),
    comparable_torn_attacks: Number((run as any).comparable_torn_attacks ?? 0),
    local_attacks_checked: Number((run as any).local_attacks_checked ?? 0),
    findings_count: Number((run as any).findings_count ?? 0),
    truncated: Number((run as any).truncated ?? 0),
    error: (run as any).error ?? null,
    created_at: Number((run as any).created_at),
    completed_at: nullableNumber((run as any).completed_at),
    items: ((itemsResult.results ?? []) as any[]).map(normalizeReconciliationItem),
  };
}

export async function runWarReportAttackReconciliationIfNeeded(
  env: Env,
  options: {
    war: ReportAttackReconciliationWar;
    mismatches: ReportAttackReconciliationMismatch[];
    force?: boolean;
  },
): Promise<ReportAttackReconciliationResult> {
  const attackMismatches = options.mismatches.filter((row) => row.attack_diff !== 0);
  if (attackMismatches.length === 0) {
    return { status: "skipped", reason: "no_attack_mismatches" };
  }

  const officialStartTime = options.war.official_start_time;
  const officialEndTime = options.war.official_end_time;
  if (officialStartTime === null || officialEndTime === null) {
    return { status: "skipped", reason: "missing_official_window" };
  }

  const memberIds = [...new Set(attackMismatches.map((row) => row.member_id))].sort((a, b) => a - b);
  const memberNames = new Map(attackMismatches.map((row) => [row.member_id, row.member_name]));

  try {
    const latestRun = await readLatestReconciliationRun(env, options.war.id);
    if (
      !options.force &&
      latestRun?.status === "completed" &&
      nullableNumberEquals(latestRun.torn_report_fetched_at, options.war.torn_report_fetched_at)
    ) {
      return {
        status: "skipped",
        reason: "already_completed_for_report",
        run_id: latestRun.id,
        member_ids: memberIds,
      };
    }

    const runId = await createReconciliationRun(env, {
      warId: options.war.id,
      tornReportFetchedAt: options.war.torn_report_fetched_at,
      officialStartTime,
      officialEndTime,
      memberIds,
    });

    try {
      const tornFetch = await fetchTornOfficialWindowAttacks(env, {
        from: Math.max(0, officialStartTime - FETCH_WINDOW_BUFFER_SECONDS),
        to: officialEndTime + FETCH_WINDOW_BUFFER_SECONDS,
      });
      const tornComparable = tornFetch.attacks.filter((attack) =>
        isComparableTornAttack(attack, {
          memberIds,
          officialStartTime,
          officialEndTime,
          enemyFactionId: options.war.enemy_faction_id,
        })
      );
      const tornComparableById = new Map(tornComparable.map((attack) => [attack.id, attack]));
      const localById = await readLocalAttacksForIds(env, [...tornComparableById.keys()]);
      const localIncludedRows = await readLocalIncludedAttacks(env, {
        warId: options.war.id,
        memberIds,
        officialStartTime,
        officialEndTime,
        enemyFactionId: options.war.enemy_faction_id,
      });
      const localIncludedById = new Map(localIncludedRows.map((row) => [row.id, row]));
      const localIdsChecked = new Set<number>([
        ...localById.keys(),
        ...localIncludedById.keys(),
      ]);

      const findings: ReconciliationFinding[] = [];

      for (const attack of tornComparable) {
        const local = localById.get(attack.id);
        const memberId = Number(attack.attacker?.id);
        if (!local) {
          findings.push(findingFromTornAttack(options.war.id, memberId, memberNames.get(memberId) ?? null, attack, {
            source: "torn",
            classification: "missing_from_db",
            reason: "Torn returned this report-comparable attack, but it is not present in the local attacks table.",
            localWarId: null,
            localIncluded: null,
          }));
          continue;
        }

        const localIncluded = isComparableLocalAttack(local, {
          warId: options.war.id,
          officialStartTime,
          officialEndTime,
          enemyFactionId: options.war.enemy_faction_id,
        });
        if (local.war_id !== options.war.id) {
          findings.push(findingFromLocalAttack(options.war.id, memberId, memberNames.get(memberId) ?? null, local, {
            source: "both",
            classification: "present_unlinked",
            reason: local.war_id === null
              ? "Local attack exists but is not linked to any war."
              : `Local attack exists but is linked to war ${local.war_id}.`,
            localIncluded,
            tornIncluded: true,
          }));
          continue;
        }

        if (!localIncluded) {
          findings.push(findingFromLocalAttack(options.war.id, memberId, memberNames.get(memberId) ?? null, local, {
            source: "both",
            classification: "present_excluded",
            reason: localExclusionReason(local, {
              warId: options.war.id,
              officialStartTime,
              officialEndTime,
              enemyFactionId: options.war.enemy_faction_id,
            }),
            localIncluded,
            tornIncluded: true,
          }));
          continue;
        }

        const fieldMismatch = localFieldMismatchReason(local, attack);
        if (fieldMismatch) {
          findings.push(findingFromLocalAttack(options.war.id, memberId, memberNames.get(memberId) ?? null, local, {
            source: "both",
            classification: "field_mismatch",
            reason: fieldMismatch,
            localIncluded,
            tornIncluded: true,
          }));
        }
      }

      for (const local of localIncludedRows) {
        if (!tornComparableById.has(local.id)) {
          const memberId = Number(local.attacker_id);
          findings.push(findingFromLocalAttack(options.war.id, memberId, memberNames.get(memberId) ?? null, local, {
            source: "local",
            classification: "local_only",
            reason: "Local attack is counted for report comparison, but it was not returned by Torn for the official window.",
            localIncluded: true,
            tornIncluded: false,
          }));
        }
      }

      await replaceReconciliationItems(env, runId, findings);
      await completeReconciliationRun(env, runId, {
        tornAttacksFetched: tornFetch.attacks.length,
        comparableTornAttacks: tornComparable.length,
        localAttacksChecked: localIdsChecked.size,
        findingsCount: findings.length,
        truncated: tornFetch.truncated,
      });

      return {
        status: "completed",
        run_id: runId,
        member_ids: memberIds,
        torn_attacks_fetched: tornFetch.attacks.length,
        comparable_torn_attacks: tornComparable.length,
        local_attacks_checked: localIdsChecked.size,
        findings_count: findings.length,
        truncated: tornFetch.truncated,
      };
    } catch (err: any) {
      const message = safeErrorMessage(err);
      await failReconciliationRun(env, runId, message);
      return {
        status: "failed",
        run_id: runId,
        member_ids: memberIds,
        error: message,
      };
    }
  } catch (err: any) {
    return {
      status: "failed",
      member_ids: memberIds,
      error: safeErrorMessage(err),
    };
  }
}

async function fetchTornOfficialWindowAttacks(
  env: Env,
  options: {
    from: number;
    to: number;
  },
): Promise<{ attacks: TornAttack[]; truncated: boolean }> {
  const attacksById = new Map<number, TornAttack>();
  let page = 0;
  let cursorTo = options.to;
  let truncated = false;

  while (page < MAX_TORN_ATTACK_PAGES) {
    const url = new URL(API_URL);
    url.searchParams.set("filters", "outgoing");
    url.searchParams.set("limit", String(TORN_ATTACK_PAGE_LIMIT));
    url.searchParams.set("sort", "DESC");
    url.searchParams.set("from", String(options.from));
    url.searchParams.set("to", String(cursorTo));

    const data = await withTornKeyPool(env, {
      feature: "faction_attack_data",
      run: ({ key, keySource }) => fetchTrackedTornJson<TornAttackResponse>(env, url, {
        headers: {
          Accept: "application/json",
          Authorization: `ApiKey ${key}`,
        },
      }, {
        feature: "report-attack-reconciliation",
        keySource,
      }, {
        service: "Torn attacks",
      }),
    });
    const pageAttacks = normalizeAttacks(data.attacks);
    page += 1;

    if (pageAttacks.length === 0) {
      break;
    }

    for (const attack of pageAttacks) {
      attacksById.set(attack.id, attack);
    }

    const oldestStarted = Math.min(
      ...pageAttacks.map((attack) => Number(attack.started ?? cursorTo)),
    );
    if (pageAttacks.length < TORN_ATTACK_PAGE_LIMIT || oldestStarted <= options.from) {
      break;
    }

    cursorTo = oldestStarted - 1;
  }

  if (page >= MAX_TORN_ATTACK_PAGES) {
    truncated = true;
  }

  return {
    attacks: [...attacksById.values()],
    truncated,
  };
}

function isComparableTornAttack(
  attack: TornAttack,
  options: {
    memberIds: number[];
    officialStartTime: number;
    officialEndTime: number;
    enemyFactionId: number | null;
  },
): boolean {
  const memberId = attack.attacker?.id;
  if (memberId === undefined || !options.memberIds.includes(memberId)) {
    return false;
  }

  if (attack.attacker?.faction?.id !== HOME_FACTION_ID) {
    return false;
  }

  if (options.enemyFactionId !== null && attack.defender?.faction?.id !== options.enemyFactionId) {
    return false;
  }

  if (!attack.result || !POSITIVE_ATTACK_RESULT_SET.has(attack.result)) {
    return false;
  }

  const endedOrStarted = Number(attack.ended ?? attack.started ?? 0);
  return Number(attack.started ?? 0) >= options.officialStartTime &&
    endedOrStarted <= options.officialEndTime;
}

function isComparableLocalAttack(
  row: LocalAttackRow,
  options: {
    warId: number;
    officialStartTime: number;
    officialEndTime: number;
    enemyFactionId: number | null;
  },
): boolean {
  if (row.war_id !== options.warId) return false;
  if (row.attacker_faction_id !== HOME_FACTION_ID) return false;
  if (options.enemyFactionId !== null && row.defender_faction_id !== options.enemyFactionId) return false;
  if (!row.result || !POSITIVE_ATTACK_RESULT_SET.has(row.result)) return false;
  if (row.started === null || row.started < options.officialStartTime) return false;

  const endedOrStarted = row.ended ?? row.started;
  return endedOrStarted <= options.officialEndTime;
}

function localExclusionReason(
  row: LocalAttackRow,
  options: {
    warId: number;
    officialStartTime: number;
    officialEndTime: number;
    enemyFactionId: number | null;
  },
): string {
  if (row.war_id !== options.warId) return "Local attack is not linked to this war.";
  if (row.attacker_faction_id !== HOME_FACTION_ID) return "Local attacker faction is not the home faction.";
  if (options.enemyFactionId !== null && row.defender_faction_id !== options.enemyFactionId) {
    return "Local defender faction is not the recorded enemy faction.";
  }
  if (!row.result || !POSITIVE_ATTACK_RESULT_SET.has(row.result)) {
    return "Local attack result is not counted as a successful report attack.";
  }
  if (row.started === null) return "Local attack has no started timestamp.";
  if (row.started < options.officialStartTime) return "Local attack started before the official war window.";

  const endedOrStarted = row.ended ?? row.started;
  if (endedOrStarted > options.officialEndTime) {
    return "Local attack ended after the official war window.";
  }

  return "Local attack does not match the report-comparison predicate.";
}

function localFieldMismatchReason(row: LocalAttackRow, attack: TornAttack): string | null {
  const reasons: string[] = [];

  if ((row.result ?? null) !== (attack.result ?? null)) {
    reasons.push(`result local=${row.result ?? "-"} torn=${attack.result ?? "-"}`);
  }

  const localRespect = Number(row.respect_gain ?? 0);
  const tornRespect = Number(attack.respect_gain ?? 0);
  if (Math.abs(localRespect - tornRespect) >= RESPECT_TOLERANCE) {
    reasons.push(`respect local=${localRespect} torn=${tornRespect}`);
  }

  if ((row.defender_id ?? null) !== (attack.defender?.id ?? null)) {
    reasons.push(`defender local=${row.defender_id ?? "-"} torn=${attack.defender?.id ?? "-"}`);
  }

  return reasons.length > 0 ? `Local and Torn fields differ: ${reasons.join("; ")}.` : null;
}

async function readLocalAttacksForIds(env: Env, attackIds: number[]): Promise<Map<number, LocalAttackRow>> {
  const rows: LocalAttackRow[] = [];
  for (let index = 0; index < attackIds.length; index += LOCAL_ATTACK_QUERY_CHUNK_SIZE) {
    const chunk = attackIds.slice(index, index + LOCAL_ATTACK_QUERY_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const result = await env.DB.prepare(
      `
      SELECT ${localAttackSelectColumns()}
      FROM attacks
      WHERE id IN (${placeholders})
      `,
    )
      .bind(...chunk)
      .all();
    rows.push(...((result.results ?? []) as unknown as LocalAttackRow[]));
  }

  return new Map(rows.map((row) => [Number(row.id), normalizeLocalAttackRow(row)]));
}

async function readLocalIncludedAttacks(
  env: Env,
  options: {
    warId: number;
    memberIds: number[];
    officialStartTime: number;
    officialEndTime: number;
    enemyFactionId: number | null;
  },
): Promise<LocalAttackRow[]> {
  if (options.memberIds.length === 0) {
    return [];
  }

  const placeholders = options.memberIds.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `
    SELECT ${localAttackSelectColumns()}
    FROM attacks
    WHERE war_id = ?
      AND attacker_id IN (${placeholders})
      AND attacker_faction_id = ?
      AND (? IS NULL OR defender_faction_id = ?)
      AND result IN (${POSITIVE_ATTACK_RESULTS.map(() => "?").join(",")})
      AND started >= ?
      AND COALESCE(ended, started) <= ?
    `,
  )
    .bind(
      options.warId,
      ...options.memberIds,
      HOME_FACTION_ID,
      options.enemyFactionId,
      options.enemyFactionId,
      ...POSITIVE_ATTACK_RESULTS,
      options.officialStartTime,
      options.officialEndTime,
    )
    .all();

  return ((result.results ?? []) as unknown as LocalAttackRow[]).map(normalizeLocalAttackRow);
}

function localAttackSelectColumns(): string {
  return `
    id,
    war_id,
    code,
    started,
    ended,
    attacker_id,
    attacker_name,
    attacker_faction_id,
    defender_id,
    defender_name,
    defender_faction_id,
    defender_faction_name,
    result,
    respect_gain,
    chain
  `;
}

function normalizeLocalAttackRow(row: LocalAttackRow): LocalAttackRow {
  return {
    ...row,
    id: Number(row.id),
    war_id: nullableNumber(row.war_id),
    started: nullableNumber(row.started),
    ended: nullableNumber(row.ended),
    attacker_id: nullableNumber(row.attacker_id),
    attacker_faction_id: nullableNumber(row.attacker_faction_id),
    defender_id: nullableNumber(row.defender_id),
    defender_faction_id: nullableNumber(row.defender_faction_id),
    respect_gain: nullableNumber(row.respect_gain),
    chain: nullableNumber(row.chain),
  };
}

function findingFromTornAttack(
  warId: number,
  memberId: number,
  memberName: string | null,
  attack: TornAttack,
  options: {
    source: "torn";
    classification: string;
    reason: string;
    localWarId: number | null;
    localIncluded: boolean | null;
  },
): ReconciliationFinding {
  return {
    warId,
    memberId,
    memberName,
    attackId: attack.id,
    attackCode: attack.code ?? null,
    source: options.source,
    classification: options.classification,
    reason: options.reason,
    started: nullableNumber(attack.started),
    ended: nullableNumber(attack.ended),
    attackerId: nullableNumber(attack.attacker?.id),
    attackerName: attack.attacker?.name ?? null,
    defenderId: nullableNumber(attack.defender?.id),
    defenderName: attack.defender?.name ?? null,
    defenderFactionId: nullableNumber(attack.defender?.faction?.id),
    defenderFactionName: attack.defender?.faction?.name ?? null,
    result: attack.result ?? null,
    respectGain: nullableNumber(attack.respect_gain),
    chain: nullableNumber(attack.chain),
    localWarId: options.localWarId,
    localIncluded: options.localIncluded,
    tornIncluded: true,
  };
}

function findingFromLocalAttack(
  warId: number,
  memberId: number,
  memberName: string | null,
  row: LocalAttackRow,
  options: {
    source: "local" | "both";
    classification: string;
    reason: string;
    localIncluded: boolean;
    tornIncluded: boolean;
  },
): ReconciliationFinding {
  return {
    warId,
    memberId,
    memberName,
    attackId: row.id,
    attackCode: row.code,
    source: options.source,
    classification: options.classification,
    reason: options.reason,
    started: row.started,
    ended: row.ended,
    attackerId: row.attacker_id,
    attackerName: row.attacker_name,
    defenderId: row.defender_id,
    defenderName: row.defender_name,
    defenderFactionId: row.defender_faction_id,
    defenderFactionName: row.defender_faction_name,
    result: row.result,
    respectGain: row.respect_gain,
    chain: row.chain,
    localWarId: row.war_id,
    localIncluded: options.localIncluded,
    tornIncluded: options.tornIncluded,
  };
}

async function replaceReconciliationItems(
  env: Env,
  runId: number,
  findings: ReconciliationFinding[],
): Promise<void> {
  await env.DB.prepare(
    `
    DELETE FROM war_report_attack_reconciliation_items
    WHERE run_id = ?
    `,
  ).bind(runId).run();

  for (let index = 0; index < findings.length; index += INSERT_ITEM_CHUNK_SIZE) {
    const chunk = findings.slice(index, index + INSERT_ITEM_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await env.DB.batch(chunk.map((finding) =>
      env.DB.prepare(
        `
        INSERT INTO war_report_attack_reconciliation_items (
          run_id,
          war_id,
          member_id,
          member_name,
          attack_id,
          attack_code,
          source,
          classification,
          reason,
          started,
          ended,
          attacker_id,
          attacker_name,
          defender_id,
          defender_name,
          defender_faction_id,
          defender_faction_name,
          result,
          respect_gain,
          chain,
          local_war_id,
          local_included,
          torn_included
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).bind(
        runId,
        finding.warId,
        finding.memberId,
        finding.memberName,
        finding.attackId,
        finding.attackCode,
        finding.source,
        finding.classification,
        finding.reason,
        finding.started,
        finding.ended,
        finding.attackerId,
        finding.attackerName,
        finding.defenderId,
        finding.defenderName,
        finding.defenderFactionId,
        finding.defenderFactionName,
        finding.result,
        finding.respectGain,
        finding.chain,
        finding.localWarId,
        nullableBoolToInt(finding.localIncluded),
        nullableBoolToInt(finding.tornIncluded),
      )
    ));
  }
}

async function readLatestReconciliationRun(
  env: Env,
  warId: number,
): Promise<{ id: number; status: string; torn_report_fetched_at: number | null } | null> {
  const row = await env.DB.prepare(
    `
    SELECT id, status, torn_report_fetched_at
    FROM war_report_attack_reconciliation_runs
    WHERE war_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
  )
    .bind(warId)
    .first();

  if (!row) return null;
  return {
    id: Number((row as any).id),
    status: String((row as any).status),
    torn_report_fetched_at: nullableNumber((row as any).torn_report_fetched_at),
  };
}

async function createReconciliationRun(
  env: Env,
  options: {
    warId: number;
    tornReportFetchedAt: number | null;
    officialStartTime: number;
    officialEndTime: number;
    memberIds: number[];
  },
): Promise<number> {
  const result = await env.DB.prepare(
    `
    INSERT INTO war_report_attack_reconciliation_runs (
      war_id,
      torn_report_fetched_at,
      official_start_time,
      official_end_time,
      member_ids_json,
      status
    )
    VALUES (?, ?, ?, ?, ?, 'running')
    `,
  )
    .bind(
      options.warId,
      options.tornReportFetchedAt,
      options.officialStartTime,
      options.officialEndTime,
      JSON.stringify(options.memberIds),
    )
    .run();

  return Number((result.meta as { last_row_id?: unknown } | undefined)?.last_row_id ?? 0);
}

async function completeReconciliationRun(
  env: Env,
  runId: number,
  summary: {
    tornAttacksFetched: number;
    comparableTornAttacks: number;
    localAttacksChecked: number;
    findingsCount: number;
    truncated: boolean;
  },
): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE war_report_attack_reconciliation_runs
    SET status = 'completed',
        torn_attacks_fetched = ?,
        comparable_torn_attacks = ?,
        local_attacks_checked = ?,
        findings_count = ?,
        truncated = ?,
        error = NULL,
        completed_at = unixepoch()
    WHERE id = ?
    `,
  )
    .bind(
      summary.tornAttacksFetched,
      summary.comparableTornAttacks,
      summary.localAttacksChecked,
      summary.findingsCount,
      boolToInt(summary.truncated),
      runId,
    )
    .run();
}

async function failReconciliationRun(env: Env, runId: number, error: string): Promise<void> {
  await env.DB.prepare(
    `
    UPDATE war_report_attack_reconciliation_runs
    SET status = 'failed',
        error = ?,
        completed_at = unixepoch()
    WHERE id = ?
    `,
  )
    .bind(error, runId)
    .run();
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBoolToInt(value: boolean | null): number | null {
  return value === null ? null : boolToInt(value);
}

function normalizeReconciliationItem(row: any): ReportAttackReconciliationItem {
  return {
    id: Number(row.id),
    run_id: Number(row.run_id),
    war_id: Number(row.war_id),
    member_id: Number(row.member_id),
    member_name: row.member_name ?? null,
    attack_id: nullableNumber(row.attack_id),
    attack_code: row.attack_code ?? null,
    source: normalizeItemSource(row.source),
    classification: String(row.classification ?? "unknown"),
    reason: String(row.reason ?? ""),
    started: nullableNumber(row.started),
    ended: nullableNumber(row.ended),
    attacker_id: nullableNumber(row.attacker_id),
    attacker_name: row.attacker_name ?? null,
    defender_id: nullableNumber(row.defender_id),
    defender_name: row.defender_name ?? null,
    defender_faction_id: nullableNumber(row.defender_faction_id),
    defender_faction_name: row.defender_faction_name ?? null,
    result: row.result ?? null,
    respect_gain: nullableNumber(row.respect_gain),
    chain: nullableNumber(row.chain),
    local_war_id: nullableNumber(row.local_war_id),
    local_included: nullableNumber(row.local_included),
    torn_included: nullableNumber(row.torn_included),
  };
}

function normalizeItemSource(value: unknown): "torn" | "local" | "both" {
  return value === "local" || value === "both" ? value : "torn";
}

function normalizeRunStatus(value: unknown): "running" | "completed" | "failed" {
  return value === "running" || value === "failed" ? value : "completed";
}

function parseMemberIds(value: unknown): number[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.map((item) => Number(item)).filter((item) => Number.isInteger(item))
      : [];
  } catch {
    return [];
  }
}

function nullableNumberEquals(left: number | null, right: number | null): boolean {
  return left === right || (left === null && right === null);
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
