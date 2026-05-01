import { HOME_FACTION_ID, SOURCE_NAME } from "./constants";
import { ingestHistoricalWarWindow } from "./ingestion";
import { DEFENSE_ACTION_WINDOW_SQL } from "./sql";
import { rebuildWarMemberStatsFromRaw, rebuildWarSummaryFromRaw } from "./summaries";
import { Env, WarRow } from "./types";
import { json } from "./utils";

type RelinkWarRow = Pick<
  WarRow,
  | "id"
  | "name"
  | "practical_start_time"
  | "practical_finish_time"
  | "official_start_time"
  | "official_end_time"
  | "status"
  | "enemy_faction_id"
  | "torn_war_id"
>;

type RelinkWarResult = {
  war_id: number;
  name: string;
  torn_war_id: number | null;
  fetched_missing_attacks: boolean;
  fetched_attack_count: number;
  existing_linked_attacks: number;
  matching_attacks: number;
  unassigned_matching_attacks: number;
  newly_linked_attacks: number;
};

export async function relinkWarAttacks(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as {
      torn_war_id?: unknown;
      name?: unknown;
      dry_run?: unknown;
      fetch_missing?: unknown;
    };
    const tornWarId = parseOptionalInteger(body.torn_war_id, "torn_war_id");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const dryRun = body.dry_run !== false;
    const fetchMissing = parseOptionalBoolean(body.fetch_missing);
    const wars = await readRelinkWars(env, tornWarId, name);

    if (wars.length === 0) {
      return json({ ok: false, error: "War not found", code: "WAR_NOT_FOUND" }, 404);
    }

    const results: RelinkWarResult[] = [];

    for (const war of wars) {
      const result = await relinkAttacksForWar(env, war, dryRun, fetchMissing);
      results.push(result);

      if (!dryRun) {
        await rebuildWarMemberStatsFromRaw(env, war.id);
        await rebuildWarSummaryFromRaw(env, war.id);
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      fetch_missing: fetchMissing,
      scope: tornWarId !== null || name ? "single_war" : "all_wars",
      wars_processed: results.length,
      total_fetched_attack_count: sumRelinkResults(results, "fetched_attack_count"),
      total_existing_linked_attacks: sumRelinkResults(results, "existing_linked_attacks"),
      total_matching_attacks: sumRelinkResults(results, "matching_attacks"),
      total_unassigned_matching_attacks: sumRelinkResults(results, "unassigned_matching_attacks"),
      total_newly_linked_attacks: sumRelinkResults(results, "newly_linked_attacks"),
      wars: results,
    });
  } catch (err: any) {
    return handleRelinkError(err);
  }
}

async function readRelinkWars(
  env: Env,
  tornWarId: number | null,
  name: string,
): Promise<RelinkWarRow[]> {
  const filterSql =
    tornWarId !== null
      ? "WHERE torn_war_id = ?"
      : name
        ? "WHERE LOWER(name) = LOWER(?)"
        : "";
  const bindings = tornWarId !== null ? [tornWarId] : name ? [name] : [];
  const rows = await env.DB.prepare(
    `
    SELECT
      id,
      name,
      practical_start_time,
      practical_finish_time,
      official_start_time,
      official_end_time,
      status,
      enemy_faction_id,
      torn_war_id
    FROM wars
    ${filterSql}
    ORDER BY practical_start_time ASC, id ASC
    `,
  )
    .bind(...bindings)
    .all();

  return (rows.results ?? []) as RelinkWarRow[];
}

async function relinkAttacksForWar(
  env: Env,
  war: RelinkWarRow,
  dryRun: boolean,
  fetchMissing: boolean,
): Promise<RelinkWarResult> {
  let fetchedMissingAttacks = false;
  let fetchedAttackCount = 0;

  if (fetchMissing && !dryRun) {
    const fetchWindow = relinkFetchWindow(war);
    if (fetchWindow !== null) {
      fetchedAttackCount = await ingestHistoricalWarWindow(
        env,
        war.id,
        fetchWindow.start,
        fetchWindow.finish,
      );
      fetchedMissingAttacks = true;
    }
  }

  const [existingLinked, matching, unassignedMatching] = await Promise.all([
    countLinkedAttacks(env, war.id),
    countMatchingRelinkAttacks(env, war.id, false),
    countMatchingRelinkAttacks(env, war.id, true),
  ]);
  let newlyLinkedAttacks = 0;

  if (!dryRun && unassignedMatching > 0) {
    const updateResult = await env.DB.prepare(
      `
      UPDATE attacks
      SET war_id = ?
      WHERE id IN (
        SELECT a.id
        FROM attacks a
        JOIN wars w ON w.id = ?
        WHERE a.war_id IS NULL
          AND ${RELINK_ATTACK_MATCH_SQL}
      )
      `,
    )
      .bind(war.id, war.id)
      .run();
    newlyLinkedAttacks = Number(updateResult.meta?.changes ?? 0);
  }

  return {
    war_id: war.id,
    name: war.name,
    torn_war_id: war.torn_war_id,
    fetched_missing_attacks: fetchedMissingAttacks,
    fetched_attack_count: fetchedAttackCount,
    existing_linked_attacks: existingLinked,
    matching_attacks: matching,
    unassigned_matching_attacks: unassignedMatching,
    newly_linked_attacks: newlyLinkedAttacks,
  };
}

function relinkFetchWindow(war: RelinkWarRow): { start: number; finish: number } | null {
  const start = war.official_start_time ?? war.practical_start_time;
  const finish = war.official_end_time ?? war.practical_finish_time;

  if (finish === null || finish < start) {
    return null;
  }

  return { start, finish };
}

async function countLinkedAttacks(env: Env, warId: number): Promise<number> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM attacks
    WHERE war_id = ?
    `,
  )
    .bind(warId)
    .first()) as { count: number } | null;

  return Number(row?.count ?? 0);
}

async function countMatchingRelinkAttacks(
  env: Env,
  warId: number,
  unassignedOnly: boolean,
): Promise<number> {
  const row = (await env.DB.prepare(
    `
    SELECT COUNT(*) AS count
    FROM attacks a
    JOIN wars w ON w.id = ?
    WHERE ${unassignedOnly ? "a.war_id IS NULL AND" : ""}
      ${RELINK_ATTACK_MATCH_SQL}
    `,
  )
    .bind(warId)
    .first()) as { count: number } | null;

  return Number(row?.count ?? 0);
}

function sumRelinkResults(results: RelinkWarResult[], key: keyof RelinkWarResult): number {
  return results.reduce((total, result) => total + Number(result[key] ?? 0), 0);
}

const RELINK_ATTACK_MATCH_SQL = `
  (
    (
      a.attacker_faction_id = ${HOME_FACTION_ID}
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
    OR (
      w.enemy_faction_id IS NOT NULL
      AND a.attacker_faction_id = w.enemy_faction_id
      AND a.defender_faction_id = ${HOME_FACTION_ID}
      AND ${DEFENSE_ACTION_WINDOW_SQL}
    )
  )
`;

function parseOptionalBoolean(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return Boolean(value);
}

function parseOptionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${field}`);
  }

  return parsed;
}

function handleRelinkError(err: any): Response {
  const message = err?.message || String(err);

  if (message.includes("Unexpected token")) {
    return json({ ok: false, error: "Invalid JSON body", code: "INVALID_JSON" }, 400);
  }

  if (message.startsWith("Invalid ")) {
    return json({ ok: false, error: message, code: "INVALID_INPUT" }, 400);
  }

  if (message.includes("FOREIGN KEY constraint failed")) {
    return json({ ok: false, error: "Referenced war does not exist", code: "WAR_NOT_FOUND" }, 404);
  }

  if (message.includes(SOURCE_NAME)) {
    return json({ ok: false, error: message, code: "SYNC_STATE_ERROR" }, 500);
  }

  return json({ ok: false, error: message, code: "INTERNAL_ERROR" }, 500);
}
