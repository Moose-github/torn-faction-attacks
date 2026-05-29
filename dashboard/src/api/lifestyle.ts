import { getJson, postJson } from "./client";
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
  const params = new URLSearchParams();
  if (options.startDate) {
    params.set("start_date", options.startDate);
  }
  if (options.endDate) {
    params.set("end_date", options.endDate);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<MemberLifestyleStatsResponse>(`/api/member-lifestyle-stats${suffix}`);
}

export async function getMemberLifestyleDailyChart(options: {
  startDate?: string;
  endDate?: string;
  metric: MemberLifestyleDailyMetric;
  memberIds: number[];
}): Promise<MemberLifestyleDailyChartResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.set("start_date", options.startDate);
  }
  if (options.endDate) {
    params.set("end_date", options.endDate);
  }
  params.set("metric", options.metric);
  for (const memberId of options.memberIds) {
    params.append("member_id", String(memberId));
  }

  return getJson<MemberLifestyleDailyChartResponse>(`/api/member-lifestyle-stats/daily?${params.toString()}`);
}
