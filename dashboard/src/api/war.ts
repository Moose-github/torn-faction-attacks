import { API_BASE_URL, authHeaders, filenameFromContentDisposition, getJson, postJson } from "./client";
import type { AdminWarPayload, AttackExportOptions, AttackWindowPayload, EnemyPushPressureResponse, EnemyScoutingResponse, FactionActivityHeatmapResponse, MemberAttacksResponse, ReportDiscrepanciesResponse, ScoutingComparisonResponse, StatsResponse, WarActivityResponse, WarChainBonusesResponse, WarDetailResponse, WarMemberActivityHeatmapResponse, WarsResponse, WarType } from "./types";

export async function getStats(
  warType: WarType,
  options: { currentMembersOnly?: boolean } = {},
): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (warType !== "all") {
    params.set("war_type", warType);
  }
  if (options.currentMembersOnly) {
    params.set("current_members", "1");
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<StatsResponse>(`/api/stats${suffix}`);
}

export async function getWars(warType: WarType): Promise<WarsResponse> {
  return getJson<WarsResponse>(`/api/wars${queryForWarType(warType)}`);
}

export async function getWar(name: string): Promise<WarDetailResponse> {
  return getJson<WarDetailResponse>(`/api/wars/${encodeURIComponent(name)}`);
}

export async function getWarMemberAttacks(
  warName: string,
  memberId: number,
): Promise<MemberAttacksResponse> {
  return getJson<MemberAttacksResponse>(
    `/api/wars/${encodeURIComponent(warName)}/members/${memberId}/attacks`,
  );
}

export async function getWarActivity(
  warName: string,
  window: "practical" | "official" = "practical",
): Promise<WarActivityResponse> {
  return getJson<WarActivityResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity?bucket_minutes=15&window=${window}`,
  );
}

export async function getWarActivityHeatmap(
  warName: string,
  warId?: number,
): Promise<FactionActivityHeatmapResponse> {
  const query = typeof warId === "number" ? `?war_id=${encodeURIComponent(String(warId))}` : "";
  return getJson<FactionActivityHeatmapResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity-heatmap${query}`,
  );
}

export async function getWarMemberActivityHeatmap(
  warName: string,
): Promise<WarMemberActivityHeatmapResponse> {
  return getJson<WarMemberActivityHeatmapResponse>(
    `/api/wars/${encodeURIComponent(warName)}/member-activity-heatmap`,
  );
}

export async function getWarChainBonuses(warName: string): Promise<WarChainBonusesResponse> {
  return getJson<WarChainBonusesResponse>(
    `/api/wars/${encodeURIComponent(warName)}/chain-bonuses`,
  );
}

export async function getWarReportDiscrepancies(
  warName: string,
): Promise<ReportDiscrepanciesResponse> {
  return getJson<ReportDiscrepanciesResponse>(
    `/api/wars/${encodeURIComponent(warName)}/report-discrepancies`,
  );
}

export async function getEnemyScouting(warName: string): Promise<EnemyScoutingResponse> {
  return getJson<EnemyScoutingResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-scouting`,
  );
}

export async function getScoutingComparison(
  warName: string,
): Promise<ScoutingComparisonResponse> {
  return getJson<ScoutingComparisonResponse>(
    `/api/wars/${encodeURIComponent(warName)}/scouting-comparison`,
  );
}

export async function getEnemyPushPressure(
  warName: string,
  options: { includeHistory?: boolean } = {},
): Promise<EnemyPushPressureResponse> {
  const query = options.includeHistory === false ? "?include_history=0" : "";
  return getJson<EnemyPushPressureResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-push-pressure${query}`,
  );
}

export async function updateOfficialWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/update-official", payload);
}

export async function importWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import", payload);
}

export async function previewImportWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import/preview", {
    practical_start_time: payload.practical_start_time,
    practical_finish_time: payload.practical_finish_time,
    official_start_time: payload.official_start_time,
    official_end_time: payload.official_end_time,
    war_type: payload.war_type,
    torn_war_id: payload.torn_war_id,
  });
}

export async function pullAttackWindow(payload: AttackWindowPayload): Promise<unknown> {
  return postJson("/api/attacks/window", payload);
}

export async function deleteWar(payload: {
  torn_war_id?: number;
  name?: string;
}): Promise<unknown> {
  return postJson("/api/wars/delete", payload);
}

export async function previewRelinkAttacks(payload: {
  torn_war_id?: number;
  name?: string;
  fetch_missing?: boolean;
}): Promise<unknown> {
  return postJson("/api/wars/relink-attacks", { ...payload, dry_run: true });
}

export async function relinkAttacks(payload: {
  torn_war_id?: number;
  name?: string;
  fetch_missing?: boolean;
}): Promise<unknown> {
  return postJson("/api/wars/relink-attacks", { ...payload, dry_run: false });
}

export async function endActiveWar(options: { practical_finish_time?: number } = {}): Promise<unknown> {
  return postJson(
    "/api/wars/end",
    options.practical_finish_time === undefined ? undefined : options,
  );
}

export async function fetchTornWarReport(tornWarId: number): Promise<unknown> {
  return postJson(`/api/torn-wars/${encodeURIComponent(tornWarId)}/report/fetch`);
}

export async function refreshEnemyScouting(warName: string): Promise<EnemyScoutingResponse> {
  return postJson<EnemyScoutingResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-scouting`,
  );
}

export async function exportWarAttacksCsv(options: AttackExportOptions): Promise<void> {
  const params = new URLSearchParams({
    format: "csv",
    scope: options.scope,
    start_window: options.startWindow,
    finish_window: options.finishWindow,
    linked_status: options.linkedStatus,
    columns: options.columns,
  });

  if (options.customStart !== undefined) {
    params.set("custom_start", String(options.customStart));
  }
  if (options.customFinish !== undefined) {
    params.set("custom_finish", String(options.customFinish));
  }

  const response = await fetch(
    `${API_BASE_URL}/api/wars/${encodeURIComponent(options.warName)}/attacks?${params.toString()}`,
    { headers: authHeaders(true) },
  );

  if (!response.ok) {
    const text = await response.text();
    let message = `Request failed: ${response.status}`;
    try {
      const data = JSON.parse(text);
      message = data.error ?? message;
    } catch {
      if (text.trim()) {
        message = text;
      }
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = filenameFromContentDisposition(disposition) ?? `${options.warName}-attacks.csv`;
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

function queryForWarType(warType: WarType): string { return warType === "all" ? "" : `?war_type=${encodeURIComponent(warType)}`; }
