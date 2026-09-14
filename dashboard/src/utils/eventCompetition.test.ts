import { describe, expect, it } from "vitest";
import type { CompetitionMember, EventCompetition } from "../api/competition";
import { eliminationRowStatus } from "./eventCompetition";

const competition = { event_type: "elimination", eliminated_teams: ["Loose Cannons"] } as EventCompetition;
const member = { participation: "participating", team_name: "Loose Cannons" } as CompetitionMember;

describe("Elimination row presentation", () => {
  it("marks members of manually eliminated teams", () => {
    expect(eliminationRowStatus(competition, member)).toBe("Eliminated");
    expect(eliminationRowStatus({ ...competition, eliminated_teams: [] }, member)).toBeNull();
  });
  it("greys non-participants without treating missing data as non-participation", () => {
    expect(eliminationRowStatus(competition, { ...member, participation: "not_participating", team_name: null })).toBe("Not participating");
    expect(eliminationRowStatus(competition, { ...member, participation: null, team_name: null })).toBeNull();
    expect(eliminationRowStatus(competition, undefined)).toBeNull();
  });
  it("does not affect other teams or Halloween members", () => {
    expect(eliminationRowStatus(competition, { ...member, team_name: "Other team" })).toBeNull();
    expect(eliminationRowStatus({ ...competition, event_type: "halloween" }, member)).toBeNull();
    expect(eliminationRowStatus(null, member)).toBeNull();
  });
});
