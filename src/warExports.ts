import { HOME_FACTION_ID } from "./constants";
import { Env, WarRow } from "./types";
import { corsHeaders, json, nowSeconds } from "./utils";
import { readWarFromUrl } from "./warRequest";

export async function exportWarAttacksCsv(url: URL, env: Env): Promise<Response> {
  try {
    const war = await readWarFromUrl(url, env);
    if (war instanceof Response) return war;

    const scope = parseExportOption(url.searchParams.get("scope"), [
      "all",
      "outgoing",
      "war_relevant",
    ] as const, "war_relevant");
    const fallbackWindowMode = parseExportOption(url.searchParams.get("window"), [
      "official",
      "practical",
      "custom",
    ] as const, "official");
    const startWindowMode = parseExportOption(url.searchParams.get("start_window"), [
      "official",
      "practical",
      "custom",
    ] as const, fallbackWindowMode);
    const finishWindowMode = parseExportOption(url.searchParams.get("finish_window"), [
      "official",
      "practical",
      "custom",
    ] as const, fallbackWindowMode);
    const linkedStatus = parseExportOption(url.searchParams.get("linked_status"), [
      "linked",
      "matching",
      "unlinked",
    ] as const, "linked");
    const columns = parseExportOption(url.searchParams.get("columns"), [
      "standard",
      "debug",
    ] as const, "standard");
    const windowRange = exportWindowForWar(war, startWindowMode, finishWindowMode, url);

    if (windowRange instanceof Response) {
      return windowRange;
    }

    const conditions = ["a.started >= ?", "COALESCE(a.ended, a.started) <= ?"];
    const binds: unknown[] = [windowRange.start, windowRange.finish];

    if (linkedStatus === "linked") {
      conditions.push("a.war_id = ?");
      binds.push(war.id);
    } else if (linkedStatus === "unlinked") {
      conditions.push("a.war_id IS NULL");
    }

    if (scope === "outgoing") {
      conditions.push(`a.attacker_faction_id = ${HOME_FACTION_ID}`);
    } else if (scope === "war_relevant") {
      conditions.push(`
        (
          a.attacker_faction_id = ${HOME_FACTION_ID}
          OR (
            ? IS NOT NULL
            AND a.attacker_faction_id = ?
            AND a.defender_faction_id = ${HOME_FACTION_ID}
          )
        )
      `);
      binds.push(war.enemy_faction_id, war.enemy_faction_id);
    }

    const rows = await env.DB.prepare(
      `
      SELECT *
      FROM attacks a
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY a.started ASC, a.id ASC
      `,
    )
      .bind(...binds)
      .all();

    const csv = attacksToCsv(
      ((rows.results ?? []) as Record<string, unknown>[]).map(addPlayerColumns),
      columns,
    );
    const filename = `${sanitizeFilename(war.name)}-${startWindowMode}-to-${finishWindowMode}-${scope}-${linkedStatus}.csv`;

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err), code: "INTERNAL_ERROR" }, 500);
  }
}

function parseExportOption<T extends readonly string[]>(
  value: string | null,
  allowed: T,
  fallback: T[number],
): T[number] {
  if (!value) {
    return fallback;
  }

  return allowed.includes(value) ? value : fallback;
}

function exportWindowForWar(
  war: WarRow,
  startWindowMode: "official" | "practical" | "custom",
  finishWindowMode: "official" | "practical" | "custom",
  url: URL,
): { start: number; finish: number } | Response {
  const start = exportBoundaryForWar(war, startWindowMode, "start", url);
  const finish = exportBoundaryForWar(war, finishWindowMode, "finish", url);

  if (!Number.isInteger(start) || !Number.isInteger(finish) || finish < start) {
    return json(
      { ok: false, error: "Selected export window is not available", code: "EXPORT_WINDOW_UNAVAILABLE" },
      400,
    );
  }

  return { start, finish };
}

function exportBoundaryForWar(
  war: WarRow,
  windowMode: "official" | "practical" | "custom",
  boundary: "start" | "finish",
  url: URL,
): number {
  if (windowMode === "custom") {
    return Number(url.searchParams.get(boundary === "start" ? "custom_start" : "custom_finish"));
  }

  if (boundary === "start") {
    return windowMode === "official"
      ? (war.official_start_time ?? war.practical_start_time)
      : war.practical_start_time;
  }

  return windowMode === "official"
    ? (war.official_end_time ?? war.practical_finish_time ?? nowSeconds())
    : (war.practical_finish_time ?? nowSeconds());
}

const STANDARD_EXPORT_COLUMNS = [
  "player_name",
  "player_id",
  "id",
  "war_id",
  "started",
  "ended",
  "attacker_id",
  "attacker_name",
  "attacker_faction_id",
  "attacker_faction_name",
  "defender_id",
  "defender_name",
  "defender_faction_id",
  "defender_faction_name",
  "result",
  "respect_gain",
  "respect_loss",
  "chain",
  "m_retaliation",
] as const;

const DEBUG_EXPORT_COLUMNS = [
  ...STANDARD_EXPORT_COLUMNS,
  "code",
  "attacker_level",
  "defender_level",
  "is_interrupted",
  "is_stealthed",
  "is_raid",
  "is_ranked_war",
  "m_fair_fight",
  "m_war",
  "m_retaliation",
  "m_group",
  "m_overseas",
  "m_chain",
  "m_warlord",
  "fetched_at",
  "ingest_run_id",
] as const;

function attacksToCsv(
  rows: Record<string, unknown>[],
  columns: "standard" | "debug",
): string {
  const columnNames = columns === "debug" ? DEBUG_EXPORT_COLUMNS : STANDARD_EXPORT_COLUMNS;
  const lines = [
    columnNames.join(","),
    ...rows.map((row) => columnNames.map((column) => csvCell(row[column])).join(",")),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

function addPlayerColumns(row: Record<string, unknown>): Record<string, unknown> {
  const homePlayerIsAttacker = Number(row.attacker_faction_id) === HOME_FACTION_ID;
  const homePlayerIsDefender = Number(row.defender_faction_id) === HOME_FACTION_ID;

  if (homePlayerIsAttacker) {
    return {
      ...row,
      player_name: row.attacker_name,
      player_id: row.attacker_id,
    };
  }

  if (homePlayerIsDefender) {
    return {
      ...row,
      player_name: row.defender_name,
      player_id: row.defender_id,
    };
  }

  return {
    ...row,
    player_name: row.attacker_name,
    player_id: row.attacker_id,
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function sanitizeFilename(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "war-attacks";
}
