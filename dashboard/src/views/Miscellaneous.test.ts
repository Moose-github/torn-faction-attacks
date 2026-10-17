import { describe, expect, it } from "vitest";
import type { MemberStats } from "../api";
import { calculatePayoutRows } from "./Miscellaneous";

const members = [
  { member_id: 1, respect_gained: 250, respect_gained_raw: 400, friendly_hosps: 1 },
  { member_id: 2, respect_gained: 100, respect_gained_raw: 150, friendly_hosps: 0 },
] as MemberStats[];

function calculate(overrides: Partial<Parameters<typeof calculatePayoutRows>[0]> = {}) {
  return calculatePayoutRows({
    members,
    totalPool: 3200,
    mode: "respect",
    respectBasis: "adjusted",
    pointRules: [],
    flatPaymentRules: [],
    bonusRules: [],
    ...overrides,
  });
}

describe("war payout respect limit", () => {
  it("caps earned respect before applying bonuses and splitting the remaining pool", () => {
    const payout = calculate({
      totalPool: 3300,
      respectLimit: 200,
      flatPaymentRules: [{ id: "flat", metric: "friendly_hosps", amount: "100" }],
      bonusRules: [{ id: "bonus", type: "bonus", metric: "respect_gained", operator: ">=", threshold: "225", percent: "10" }],
    });
    const first = payout.rows.find(row => row.member.member_id === 1)!;
    const second = payout.rows.find(row => row.member.member_id === 2)!;

    expect(first.basis).toBe(200);
    expect(first.adjustedBasis).toBeCloseTo(220);
    expect(first.flatPayment).toBe(100);
    expect(first.variablePayment).toBeCloseTo(2200);
    expect(first.finalPayment).toBeCloseTo(2300);
    expect(second.basis).toBe(100);
    expect(second.finalPayment).toBeCloseTo(1000);
    expect(payout.finalTotal).toBeCloseTo(3300);
    expect(members[0].respect_gained).toBe(250);
  });

  it("applies penalties to capped respect", () => {
    const payout = calculate({
      totalPool: 2800,
      respectLimit: 200,
      bonusRules: [{ id: "penalty", type: "penalty", metric: "respect_gained", operator: ">", threshold: "225", percent: "10" }],
    });
    const first = payout.rows.find(row => row.member.member_id === 1)!;
    expect(first.adjustedBasis).toBe(180);
    expect(first.finalPayment).toBeCloseTo(1800);
  });

  it.each([undefined, null])("leaves respect uncapped when the limit is %s", respectLimit => {
    const payout = calculate({ respectLimit, totalPool: 3500 });
    expect(payout.rows[0].basis).toBe(250);
    expect(payout.rows[0].finalPayment).toBe(2500);
  });

  it("caps the selected raw or adjusted respect basis", () => {
    expect(calculate({ respectLimit: 300, respectBasis: "raw" }).rows[0].basis).toBe(300);
    expect(calculate({ respectLimit: 300, respectBasis: "adjusted" }).rows[0].basis).toBe(250);
  });

  it("uses the existing adjusted-respect fallback when raw respect is unavailable", () => {
    const payout = calculate({ members: [{ ...members[0], respect_gained_raw: null }], respectLimit: 200, respectBasis: "raw" });
    expect(payout.rows[0].basis).toBe(200);
  });

  it("treats zero as a cap of zero while preserving flat payments", () => {
    const payout = calculate({ respectLimit: 0, flatPaymentRules: [{ id: "flat", metric: "friendly_hosps", amount: "100" }] });
    expect(payout.rows.every(row => row.basis === 0 && row.variablePayment === 0)).toBe(true);
    expect(payout.finalTotal).toBe(100);
  });

  it("keeps the respect-mode limit inactive in points mode", () => {
    const payout = calculate({ mode: "points", respectLimit: 200, totalPool: 3500, pointRules: [{ id: "points", metric: "respect_gained", points: "1" }] });
    expect(payout.rows[0].basis).toBe(250);
    expect(payout.rows[0].finalPayment).toBe(2500);
  });
});
