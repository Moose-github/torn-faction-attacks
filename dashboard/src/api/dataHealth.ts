import { getJson, postJson } from "./client";
import type {
  AdminDataHealthResponse,
  DataHealthSettings,
  DataHealthSummaryResponse,
} from "./types";

export async function getDataHealthSummary(): Promise<DataHealthSummaryResponse> {
  return getJson<DataHealthSummaryResponse>("/api/data-health/summary", true);
}

export async function getAdminDataHealth(windowSeconds = 24 * 60 * 60): Promise<AdminDataHealthResponse> {
  const params = new URLSearchParams({ window_seconds: String(windowSeconds) });
  return getJson<AdminDataHealthResponse>(`/api/admin/data-health?${params.toString()}`, true);
}

export async function updateDataHealthSettings(
  settings: Partial<DataHealthSettings>,
): Promise<{ ok: boolean; settings: DataHealthSettings }> {
  return postJson<{ ok: boolean; settings: DataHealthSettings }>(
    "/api/admin/data-health/settings",
    settings,
  );
}
