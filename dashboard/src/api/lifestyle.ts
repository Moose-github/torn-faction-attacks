import { getJson, postJson } from "./client";
import { queryString } from "./query";
import type { MemberLifestyleDailyChartResponse, MemberLifestyleDailyMetric, MemberLifestyleRepairJobResponse, MemberLifestyleRepairJobsResponse, MemberLifestyleStatsResponse } from "./types";

export async function getMemberLifestyleRepairJobs(): Promise<MemberLifestyleRepairJobsResponse> {
  return getJson<MemberLifestyleRepairJobsResponse>("/api/admin/member-lifestyle/repair-jobs", true);
}

export async function createMemberLifestyleRepairJob(payload: {
  start_date: string;
  end_date: string;
  calls_per_minute_per_key?: number;
  member_id?: number;
}): Promise<MemberLifestyleRepairJobResponse> {
  return postJson<MemberLifestyleRepairJobResponse>("/api/admin/member-lifestyle/repair-jobs", payload);
}

export async function cancelMemberLifestyleRepairJob(id: string): Promise<MemberLifestyleRepairJobResponse> {
  return postJson<MemberLifestyleRepairJobResponse>(
    `/api/admin/member-lifestyle/repair-jobs/${encodeURIComponent(id)}/cancel`,
  );
}

export async function getMemberLifestyleStats(options: {
  startDate?: string;
  endDate?: string;
} = {}): Promise<MemberLifestyleStatsResponse> {
  const suffix = queryString({
    start_date: options.startDate,
    end_date: options.endDate,
  });
  return getJson<MemberLifestyleStatsResponse>(`/api/member-lifestyle-stats${suffix}`);
}

export async function getMemberLifestyleDailyChart(options: {
  startDate?: string;
  endDate?: string;
  metric: MemberLifestyleDailyMetric;
  memberIds: number[];
}): Promise<MemberLifestyleDailyChartResponse> {
  return getJson<MemberLifestyleDailyChartResponse>(`/api/member-lifestyle-stats/daily${queryString({
    start_date: options.startDate,
    end_date: options.endDate,
    metric: options.metric,
    member_id: options.memberIds,
  })}`);
}
