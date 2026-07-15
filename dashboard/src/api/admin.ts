import { API_BASE_URL, authHeaders, deleteJson, getJson, postJson } from "./client";
import { queryString } from "./query";
import type { AdminDiscordAlertSettingsResponse, AdminSuggestionsResponse, AdminXanaxCompetitionResponse, EnemyStatsImagePreviewType, HomeFactionReportExemptionsResponse, IngestionRunResponse, MaintenanceRunResponse, ShopliftingAlertSetting, TornApiUsageResponse, WarControlSettingsResponse, WarControlSettingsUpdate } from "./types";

export type DiscordTravelTrackerTarget = {
  faction_id: number;
  faction_name: string | null;
  enabled: boolean;
  last_refreshed_at: number | null;
};

export type DiscordTravelTrackerTargetResponse = {
  ok: true;
  active_source: "war" | "manual" | "inactive";
  war_target: {
    war_id: number;
    faction_id: number;
    name: string;
  } | null;
  manual_target: DiscordTravelTrackerTarget | null;
  target_tracker: {
    enabled: boolean;
    active_source: "war" | "manual" | "inactive";
    war_target: {
      war_id: number;
      faction_id: number;
      name: string;
    } | null;
    manual_target: DiscordTravelTrackerTarget | null;
    message_id: string | null;
    last_synced_at: number | null;
  };
  home_tracker: {
    enabled: boolean;
    faction_id: number;
    message_id: string | null;
    last_synced_at: number | null;
  };
};

export type DiscordTravelTrackerChannelSyncResponse = {
  ok: true;
  tracker_key: "target" | "home";
  enabled: boolean;
  skipped: boolean;
  reason?: string;
  war_id: number | null;
  faction_id: number | null;
  source: "war" | "manual" | "home" | "inactive";
  message_id: string | null;
  traveling: number;
  abroad: number;
  changed: boolean;
};

export type DiscordTravelTrackerSyncResponse = DiscordTravelTrackerChannelSyncResponse & {
  target: DiscordTravelTrackerChannelSyncResponse;
  home: DiscordTravelTrackerChannelSyncResponse;
};

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

export async function getTornApiUsage(windowSeconds = 24 * 60 * 60): Promise<TornApiUsageResponse> {
  return getJson<TornApiUsageResponse>(`/api/admin/torn-api-usage${queryString({ window_seconds: windowSeconds })}`, true);
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

export async function getDiscordTravelTrackerTarget(): Promise<DiscordTravelTrackerTargetResponse> {
  return getJson<DiscordTravelTrackerTargetResponse>("/api/admin/discord-travel-tracker/target", true);
}

export async function setDiscordTravelTrackerTarget(payload: {
  faction_id: number;
  faction_name?: string;
}): Promise<{ ok: true; target: DiscordTravelTrackerTarget | null }> {
  return postJson<{ ok: true; target: DiscordTravelTrackerTarget | null }>(
    "/api/admin/discord-travel-tracker/target",
    payload,
  );
}

export async function clearDiscordTravelTrackerTarget(): Promise<{ ok: true; cleared: number }> {
  return deleteJson<{ ok: true; cleared: number }>("/api/admin/discord-travel-tracker/target", true);
}

export async function updateDiscordTravelTrackerSettings(payload: {
  target_enabled?: boolean;
  home_enabled?: boolean;
}): Promise<{
  ok: true;
  target_enabled: boolean;
  home_enabled: boolean;
  sync: DiscordTravelTrackerSyncResponse;
}> {
  return postJson(
    "/api/admin/discord-travel-tracker/settings",
    payload,
  );
}

export async function syncDiscordTravelTracker(): Promise<DiscordTravelTrackerSyncResponse> {
  return postJson<DiscordTravelTrackerSyncResponse>("/api/admin/discord-travel-tracker/sync");
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
    `/api/admin/suggestions${queryString({ limit })}`,
    true,
  );
}

export async function getAdminXanaxCompetition(): Promise<AdminXanaxCompetitionResponse> {
  return getJson<AdminXanaxCompetitionResponse>("/api/admin/xanax-competition", true);
}

export async function getAdminDiscordAlertSettings(): Promise<AdminDiscordAlertSettingsResponse> {

  return getJson<AdminDiscordAlertSettingsResponse>("/api/admin/discord-alerts/settings", true);

}

export async function updateAdminShopliftingDiscordAlert(payload: {

  shop_key: ShopliftingAlertSetting["shop_key"];

  enabled: boolean;

}): Promise<AdminDiscordAlertSettingsResponse> {

  return postJson<AdminDiscordAlertSettingsResponse>("/api/admin/discord-alerts/settings", payload);

}

export async function updateAdminEnemyPushDiscordAlert(payload: {

  enabled: boolean;

}): Promise<AdminDiscordAlertSettingsResponse> {

  return postJson<AdminDiscordAlertSettingsResponse>("/api/admin/discord-alerts/settings", {
    alert_key: "enemy_push",
    enabled: payload.enabled,
  });

}

export async function updateAdminChainWatchDiscordAlert(payload: {

  enabled: boolean;

}): Promise<AdminDiscordAlertSettingsResponse> {

  return postJson<AdminDiscordAlertSettingsResponse>("/api/admin/discord-alerts/settings", {
    alert_key: "chain_watch",
    enabled: payload.enabled,
  });

}

export async function updateAdminRetaliationBoardDiscordAlert(payload: {

  enabled: boolean;

}): Promise<AdminDiscordAlertSettingsResponse> {

  return postJson<AdminDiscordAlertSettingsResponse>("/api/admin/discord-alerts/settings", {
    alert_key: "retaliation_board",
    enabled: payload.enabled,
  });

}

export async function getAdminWarControlSettings(): Promise<WarControlSettingsResponse> {
  return getJson<WarControlSettingsResponse>("/api/admin/war-control-settings", true);
}

export async function updateAdminWarControlSettings(
  payload: WarControlSettingsUpdate,
): Promise<WarControlSettingsResponse> {
  return postJson<WarControlSettingsResponse>("/api/admin/war-control-settings", payload);
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
