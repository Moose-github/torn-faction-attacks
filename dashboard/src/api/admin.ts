import { API_BASE_URL, authHeaders, getJson, postJson } from "./client";
import type { AdminSuggestionsResponse, AdminXanaxCompetitionResponse, EnemyStatsImagePreviewType, HomeFactionReportExemptionsResponse, IngestionRunResponse, MaintenanceRunResponse, TornApiUsageResponse } from "./types";

export async function runIngestion(): Promise<unknown> {
  return postJson("/api/run");
}

export async function rebuildStats(warId?: number): Promise<unknown> {
  return warId === undefined
    ? postJson("/api/rebuild")
    : postJson("/api/rebuild", { war_id: warId });
}

export async function getLatestIngestionRun(): Promise<IngestionRunResponse> {
  return getJson<IngestionRunResponse>("/api/admin/ingestion-run", true);
}

export async function getLatestMaintenanceRun(): Promise<MaintenanceRunResponse> {
  return getJson<MaintenanceRunResponse>("/api/admin/maintenance-run", true);
}

export async function getTornApiUsage(windowSeconds = 60 * 60): Promise<TornApiUsageResponse> {
  const params = new URLSearchParams({ window_seconds: String(windowSeconds) });
  return getJson<TornApiUsageResponse>(`/api/admin/torn-api-usage?${params.toString()}`, true);
}

export async function updateHomeFactionReportExemption(payload: {
  member_id: number;
  report_exempt: boolean;
  reason?: string;
}): Promise<HomeFactionReportExemptionsResponse> {
  return postJson<HomeFactionReportExemptionsResponse>(
    "/api/admin/home-faction-members/report-exemptions",
    payload,
  );
}

export async function listAdminUsers(): Promise<unknown> {
  return getJson("/api/admin/users", true);
}

export async function grantAdminAccess(tornUserId: number): Promise<unknown> {
  return postJson("/api/admin/users/grant", { torn_user_id: tornUserId });
}

export async function sendDiscordMessage(message: string): Promise<unknown> {
  return postJson("/api/admin/discord/message", { message });
}

export async function resetEnemyStatsImageLatches(): Promise<unknown> {
  return postJson("/api/admin/enemy-stats-image/reset");
}

export async function previewEnemyStatsImage(type: EnemyStatsImagePreviewType): Promise<unknown> {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) {
    throw new Error("Preview popup was blocked by the browser");
  }
  previewWindow.document.title = "Loading Discord image preview";
  previewWindow.document.body.textContent = "Loading preview...";

  const response = await fetch(
    `${API_BASE_URL}/api/admin/enemy-stats-image/preview?type=${encodeURIComponent(type)}`,
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
    previewWindow.document.body.textContent = message;
    throw new Error(message);
  }

  const blob = await response.blob();
  const previewUrl = window.URL.createObjectURL(blob);
  previewWindow.location.href = previewUrl;
  window.setTimeout(() => window.URL.revokeObjectURL(previewUrl), 300_000);
  return {
    ok: true,
    opened: true,
    preview: type,
  };
}

export async function previewXanaxCompetitionImage(): Promise<unknown> {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) {
    throw new Error("Preview popup was blocked by the browser");
  }
  previewWindow.document.title = "Loading Xanax competition image";
  previewWindow.document.body.textContent = "Loading preview...";

  const response = await fetch(
    `${API_BASE_URL}/api/admin/xanax-competition/image`,
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
    previewWindow.document.body.textContent = message;
    throw new Error(message);
  }

  const blob = await response.blob();
  const previewUrl = window.URL.createObjectURL(blob);
  previewWindow.location.href = previewUrl;
  window.setTimeout(() => window.URL.revokeObjectURL(previewUrl), 300_000);
  return {
    ok: true,
    opened: true,
    preview: "xanax-competition",
  };
}

export async function restartLiveEnemyTracking(warId: number): Promise<unknown> {
  return postJson("/api/admin/live-enemy-tracking/restart", { war_id: warId });
}

export async function getAdminSuggestions(limit = 12): Promise<AdminSuggestionsResponse> {
  return getJson<AdminSuggestionsResponse>(
    `/api/admin/suggestions?limit=${encodeURIComponent(String(limit))}`,
    true,
  );
}

export async function getAdminXanaxCompetition(): Promise<AdminXanaxCompetitionResponse> {
  return getJson<AdminXanaxCompetitionResponse>("/api/admin/xanax-competition", true);
}

export async function updateAdminXanaxCompetitionSettings(payload: {
  enabled: boolean;
  base_prize: number;
  rollover_count: number;
}): Promise<AdminXanaxCompetitionResponse> {
  return postJson<AdminXanaxCompetitionResponse>("/api/admin/xanax-competition", payload);
}

export async function recordAdminXanaxCompetitionClaim(payload: {
  member_id: number;
  month_key?: string;
  prize_paid?: number;
}): Promise<AdminXanaxCompetitionResponse> {
  return postJson<AdminXanaxCompetitionResponse>("/api/admin/xanax-competition", payload);
}
