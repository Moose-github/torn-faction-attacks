import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MemberStats, ReportDiscrepanciesResponse, WarDetailResponse, WarSummary } from "../api";
import { WarDetailView } from "./WarDetailView";

vi.mock("../components/Charts", () => ({ ActivityChart: () => null, AttackChart: () => null, MemberPointGraphs: () => null }));

const war = {
  id: 25, name: "Karma Chameleons", war_type: "real", status: "ended",
  practical_start_time: 1790449200, practical_finish_time: 1790485097,
  official_start_time: 1790449200, official_end_time: 1790622019,
  torn_report_fetched_at: 1790622100, enemy_faction_id: 99,
  official_home_attacks: 960, official_home_score: 11555,
  official_enemy_attacks: 422, official_enemy_score: 4627,
  total_respect_gain: 10738.27, total_respect_lost: 4627.37,
} as WarSummary;
const detail = {
  ok: true, war, summary: null,
  members: [{ member_id: 1, member_name: "Member", attacks_vs_enemy_successful: 927,
    defends_total: 422, defends_won: 0, defends_other: 0 } as MemberStats],
} satisfies WarDetailResponse;
const adjustments = {
  ok: true, war,
  groups: { after_practical_finish: { count: 33, respect_gain: 253.47, attacks: [] },
    chain_bonus_adjustments: { count: 1, respect_gain: 564.13, attacks: [] } },
} as unknown as ReportDiscrepanciesResponse;

function renderValidation(overrides: Partial<React.ComponentProps<typeof WarDetailView>> = {}) {
  return renderToStaticMarkup(<WarDetailView
    activityBuckets={[]} chainBonuses={[]} collapsedPanels={{ reportValidation: true }}
    factionActivityWindow="practical" isAdmin={false} isLoadingActivity={false}
    isLoadingDetail={false} isLoadingMemberCombatHeatmap={false} isLoadingMemberAttacks={false}
    isLoadingReportDiscrepancies={false} memberCombatHeatmap={null}
    memberAttackSort={{ key: "started", direction: "desc" }} memberAttacks={[]}
    memberSort={{ key: "respect_gained", direction: "desc" }}
    onMemberActivityWindowChange={() => {}} onMemberAttackSortChange={() => {}}
    onMemberSelect={() => {}} onMemberSortChange={() => {}} onOpenWarRoom={() => {}} onTogglePanel={() => {}}
    reportDiscrepancies={null} selectedMember={null} selectedWar={war} warDetail={detail}
    {...overrides}
  />);
}

describe("Torn report validation readiness", () => {
  it.each([true, false])("does not claim a mismatch before adjustments load (collapsed: %s)", (collapsed) => {
    const html = renderValidation({ collapsedPanels: { reportValidation: collapsed }, isLoadingReportDiscrepancies: true });
    expect(html).toContain("Checking totals");
    expect(html).not.toContain("mismatched measures");
    expect(html).not.toContain("Official report needs review");
    expect(html).not.toContain("All totals match");
    expect(html).not.toContain("report-validation-table");
  });

  it("keeps failed or incomplete loads neutral", () => {
    expect(renderValidation()).toContain("Validation unavailable");
    expect(renderValidation({ reportDiscrepancies: adjustments, warDetail: null, isLoadingDetail: true })).toContain("Checking totals");
    const stale = { ...adjustments, war: { ...war, id: 24 } };
    expect(renderValidation({ reportDiscrepancies: stale })).toContain("Validation unavailable");
  });

  it.each([true, false])("shows the reconciled result regardless of collapse state (%s)", (collapsed) => {
    const html = renderValidation({ collapsedPanels: { reportValidation: collapsed }, reportDiscrepancies: adjustments });
    expect(html).toContain("All totals match");
    expect(html).not.toContain("mismatched measures");
  });

  it("still reports real mismatches after all inputs load", () => {
    const html = renderValidation({ reportDiscrepancies: adjustments, selectedWar: { ...war, official_enemy_attacks: 423 } });
    expect(html).toContain("1 mismatched measure");
  });
});
