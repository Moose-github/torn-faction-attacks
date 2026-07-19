import { describe, expect, it } from "vitest";
import {
  collectEnemyCompanySnapshots,
  parseTornUserJobCompanySnapshot,
  resolveTornCompanyType,
} from "./enemyCompany";

describe("enemy company scouting", () => {
  it("parses player-owned company jobs", () => {
    expect(parseTornUserJobCompanySnapshot({
      job: {
        type: "company",
        id: 110114,
        type_id: 14,
        name: "(hiring) Fudge Around",
        rating: 8,
        position: "Director",
        days_in_company: 29,
      },
    })).toEqual({
      company_type: "Sweet Shop",
      company_rating: 8,
      company_id: 110114,
    });
  });

  it("parses city jobs as the display type", () => {
    expect(parseTornUserJobCompanySnapshot({
      job: {
        type: "job",
        name: "Army",
        position: "General",
      },
    })).toEqual({
      company_type: "Army",
      company_rating: null,
      company_id: null,
    });
  });

  it("parses unemployed players as empty company snapshots", () => {
    expect(parseTornUserJobCompanySnapshot({ job: null })).toEqual({
      company_type: null,
      company_rating: null,
      company_id: null,
    });
  });

  it("falls back for unknown future company type ids", () => {
    expect(resolveTornCompanyType(99)).toBe("Type #99");
  });

  it("keeps roster collection going when one job lookup fails", async () => {
    const errors: number[] = [];
    const snapshots = await collectEnemyCompanySnapshots(
      [{ id: 1 }, { id: 2 }],
      async (member) => {
        if (member.id === 2) {
          throw new Error("temporary Torn failure");
        }
        return {
          company_type: "Sweet Shop",
          company_rating: 8,
          company_id: 110114,
        };
      },
      (member) => errors.push(member.id),
    );

    expect(errors).toEqual([2]);
    expect(snapshots.get(1)).toEqual({
      company_type: "Sweet Shop",
      company_rating: 8,
      company_id: 110114,
    });
    expect(snapshots.get(2)).toEqual({
      company_type: null,
      company_rating: null,
      company_id: null,
    });
  });
});
