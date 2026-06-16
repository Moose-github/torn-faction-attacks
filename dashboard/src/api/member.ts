import { getJson, postJson } from "./client";
import { queryString } from "./query";
import type { DiceGameResponse, DiceGameRollResponse, DiceGameSendXanaxResponse, HomeFactionMemberSummary, HomeFactionReportExemptionsResponse, MemberAchievementsResponse, MemberSuggestionResponse, MiscellaneousResponse, MonitorTicketResponse, RecentFactionAttacksResponse, XanaxCompetitionResponse } from "./types";

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
): Promise<RecentFactionAttacksResponse> {
  const suffix = queryString({
    limit: options.limit,
    window_seconds: options.windowSeconds,
  });
  return getJson<RecentFactionAttacksResponse>(`/api/faction-attacks/recent${suffix}`);
}

export async function getMemberAchievements(): Promise<MemberAchievementsResponse> {
  return getJson<MemberAchievementsResponse>("/api/member-achievements");
}

export async function getXanaxCompetition(): Promise<XanaxCompetitionResponse> {
  return getJson<XanaxCompetitionResponse>("/api/xanax-competition");
}

export async function submitMemberSuggestion(suggestion: string): Promise<MemberSuggestionResponse> {
  return postJson<MemberSuggestionResponse>("/api/suggestions", { suggestion });
}

export async function getMiscellaneousData(): Promise<MiscellaneousResponse> {
  return getJson<MiscellaneousResponse>("/api/miscellaneous");
}

export async function createMonitorTicket(warId: number): Promise<MonitorTicketResponse> {
  return postJson<MonitorTicketResponse>("/api/monitor-ticket", {
    war_id: warId,
  });
}

export async function getDiceGame(): Promise<DiceGameResponse> {
  return getJson<DiceGameResponse>("/api/dice-game");
}

export async function rollDiceGame(
  betAmount: number,
  betNumber: number,
  hauntedOriginalNumber?: number,
): Promise<DiceGameRollResponse> {
  return postJson<DiceGameRollResponse>("/api/dice-game/roll", {
    bet_amount: betAmount,
    bet_number: betNumber,
    haunted_original_number: hauntedOriginalNumber,
  });
}

export async function sendXanaxToDiceGame(amount: number): Promise<DiceGameSendXanaxResponse> {
  return postJson<DiceGameSendXanaxResponse>("/api/dice-game/send-xanax", {
    amount,
  });
}
