import { getJson, postJson } from "./client";
import { queryString } from "./query";
import type {
  AdminDataHealthResponse,
  DailyStatsAttention,
  DataHealthSettings,
  DataHealthSummaryResponse,
} from "./types";

export async function acceptDailyStatsIssue(
  issue: Pick<DailyStatsAttention["affected_members"][number], "member_id" | "snapshot_date" | "status" | "error">,
): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>("/api/admin/data-health/daily-stats/accept", issue);
}

export async function getDataHealthSummary(signal?: AbortSignal): Promise<DataHealthSummaryResponse> {
  return getJson<DataHealthSummaryResponse>("/api/data-health/summary", true, signal);
}

export async function getAdminDataHealth(
  windowSeconds = 60 * 60,
  includeBreakdown = false,
  signal?: AbortSignal,
): Promise<AdminDataHealthResponse> {
  const suffix = queryString({
    window_seconds: windowSeconds,
    include_breakdown: includeBreakdown ? 1 : undefined,
  });
  return getJson<AdminDataHealthResponse>(`/api/admin/data-health${suffix}`, true, signal);
}

export async function updateDataHealthSettings(
  settings: Partial<DataHealthSettings>,
): Promise<{ ok: boolean; settings: DataHealthSettings }> {
  return postJson<{ ok: boolean; settings: DataHealthSettings }>(
    "/api/admin/data-health/settings",
    settings,
  );
}
