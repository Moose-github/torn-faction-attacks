import { describe, expect, it } from "vitest";
import type { PersonalStatsCoverageGap } from "../api/types";
import { groupPersonalStatsIssues } from "./personalStatsIssues";

function gap(member_id: number, snapshot_date: string): PersonalStatsCoverageGap {
  return { member_id, snapshot_date, member_name: `Member ${member_id}`, latest_personal_ready_date: null,
    recent_snapshot_date: snapshot_date, recent_status: "pending", recent_error: `Error for ${snapshot_date}`, recent_updated_at: null };
}

describe("personal stats issue rows", () => {
  it("groups all actionable dates into one row per member and keeps the oldest issue's diagnostics", () => {
    const rows = groupPersonalStatsIssues([gap(101, "2026-09-18"), gap(102, "2026-09-17"), gap(101, "2026-09-16"), gap(101, "2026-09-18")]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ member_id: 101, snapshot_date: "2026-09-16", missing_dates: ["2026-09-16", "2026-09-18"], recent_error: "Error for 2026-09-16" });
    expect(rows[1].missing_dates).toEqual(["2026-09-17"]);
  });
});
