import type { CompetitionMember, EventCompetition } from "../api/competition";

export function eliminationRowStatus(competition: EventCompetition | null | undefined, member: CompetitionMember | undefined) {
  if (competition?.event_type !== "elimination" || !member) return null;
  if (member.participation === "not_participating") return "Not participating";
  return member.team_name && competition.eliminated_teams?.includes(member.team_name) ? "Eliminated" : null;
}
