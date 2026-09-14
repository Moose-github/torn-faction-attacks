import { getJson, postJson } from "./client";

export type CompetitionMember = {
  member_id: number;
  member_name: string;
  participation: "participating" | "not_participating" | null;
  team_name: string | null;
  captured_at: number | null;
  baseline_at: number | null;
  updated_at: number | null;
  treats_gained: number | null;
  basket_name: string | null;
  status: "complete" | "unavailable" | "pending" | "finishing" | "incomplete" | "stale" | "tracking";
  last_error: string | null;
};

export type EventCompetition = {
  event_type: "elimination" | "halloween";
  eliminated_teams: string[];
  refresh_hours: 6 | 12;
  initialized_at: number | null;
  final_requested_at: number | null;
  next_refresh_at: number | null;
  total_treats_gained: number | null;
  members: CompetitionMember[];
  history: Array<{ observed_at: number; treats_gained: number }>;
};

export function getEventCompetition(name: string) {
  return getJson<{ ok: boolean; competition: EventCompetition | null }>(`/api/wars/${encodeURIComponent(name)}/competition`);
}

export function updateEliminationTeamStatus(name: string, teamName: string, eliminated: boolean) {
  return postJson<{ ok: boolean; competition: EventCompetition }>(`/api/wars/${encodeURIComponent(name)}/competition/team-status`, {
    team_name: teamName, eliminated,
  });
}
