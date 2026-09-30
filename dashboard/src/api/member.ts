import { getJson, postJson } from "./client";
import { queryString } from "./query";
import type { DiscordMemberAlertSubscriptionsResponse, HomeFactionMemberSummary, HomeFactionReportExemptionsResponse, MemberAchievementsResponse, MemberSuggestionResponse, MiscellaneousResponse, MonitorTicketResponse, RecentFactionAttacksResponse, XanaxCompetitionResponse } from "./types";

export async function getHomeFactionMemberSummary(): Promise<HomeFactionMemberSummary> {
  return getJson<HomeFactionMemberSummary>("/api/home-faction-members/summary");
}

export async function getHomeFactionReportExemptions(): Promise<HomeFactionReportExemptionsResponse> {
  return getJson<HomeFactionReportExemptionsResponse>(
    "/api/admin/home-faction-members/report-exemptions",
    true,
  );
}

export async function getRecentFactionAttacks(
  options: { limit?: number; windowSeconds?: number } = {},
  signal?: AbortSignal,
): Promise<RecentFactionAttacksResponse> {
  const suffix = queryString({
    limit: options.limit,
    window_seconds: options.windowSeconds,
  });
  return getJson<RecentFactionAttacksResponse>(`/api/faction-attacks/recent${suffix}`, true, signal);
}

export async function getMemberAchievements(signal?: AbortSignal): Promise<MemberAchievementsResponse> {
  return getJson<MemberAchievementsResponse>("/api/member-achievements", true, signal);
}

export async function getXanaxCompetition(signal?: AbortSignal): Promise<XanaxCompetitionResponse> {
  return getJson<XanaxCompetitionResponse>("/api/xanax-competition", true, signal);
}

export async function submitMemberSuggestion(suggestion: string): Promise<MemberSuggestionResponse> {
  return postJson<MemberSuggestionResponse>("/api/suggestions", { suggestion });
}

export async function getDiscordMemberAlertSubscriptions(): Promise<DiscordMemberAlertSubscriptionsResponse> {
  return getJson<DiscordMemberAlertSubscriptionsResponse>("/api/me/discord-alert-subscriptions");
}

export async function updateDiscordMemberAlertSubscription(payload: {
  alert_key: string;
  enabled: boolean;
}): Promise<DiscordMemberAlertSubscriptionsResponse> {
  return postJson<DiscordMemberAlertSubscriptionsResponse>("/api/me/discord-alert-subscriptions", payload);
}

export async function getMiscellaneousData(signal?: AbortSignal): Promise<MiscellaneousResponse> {
  return getJson<MiscellaneousResponse>("/api/miscellaneous", true, signal);
}

export async function createMonitorTicket(warId: number): Promise<MonitorTicketResponse> {
  return postJson<MonitorTicketResponse>("/api/monitor-ticket", {
    war_id: warId,
  });
}
