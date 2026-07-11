import { describe, expect, it } from "vitest";
import {
  calculateStockInvestmentIncrement,
  parseActiveStockBenefit,
  parseBenefitDescription,
  valueStockBenefit,
} from "./stockMarket";

describe("stock investment ROI parsing", () => {
  it("parses active stock benefit JSON", () => {
    expect(parseActiveStockBenefit(JSON.stringify({
      passive: false,
      frequency: 7,
      requirement: 150_000,
      description: "1x Box of Medical Supplies",
    }))).toEqual({
      status: "active",
      benefit: {
        passive: false,
        frequency: 7,
        requirement: 150_000,
        description: "1x Box of Medical Supplies",
      },
    });
  });

  it("skips passive and invalid benefit JSON", () => {
    expect(parseActiveStockBenefit(JSON.stringify({
      passive: true,
      frequency: 7,
      requirement: 150_000,
      description: "1x Box of Medical Supplies",
    }))).toEqual({ status: "passive" });
    expect(parseActiveStockBenefit("{nope")).toEqual({ status: "invalid" });
    expect(parseActiveStockBenefit(JSON.stringify({
      passive: false,
      frequency: 0,
      requirement: 150_000,
      description: "1x Box of Medical Supplies",
    }))).toEqual({ status: "invalid" });
  });

  it("parses cash and item benefit descriptions", () => {
    expect(parseBenefitDescription("$50,000,000")).toMatchObject({
      benefit_key: null,
      value: 50_000_000,
      editable: false,
    });
    expect(parseBenefitDescription("1x Box of Medical Supplies")).toMatchObject({
      benefit_key: "item:box_of_medical_supplies",
      label: "Box of Medical Supplies",
      value: 850_000,
      editable: true,
    });
    expect(parseBenefitDescription("1x Mystery Box")).toMatchObject({
      benefit_key: "item:mystery_box",
      label: "Mystery Box",
      value: null,
      editable: true,
    });
  });

  it("applies member override before default valuation", () => {
    const benefit = { description: "1x Box of Medical Supplies" };

    expect(valueStockBenefit(benefit, new Map())).toMatchObject({
      benefit_key: "item:box_of_medical_supplies",
      value: 850_000,
      source: "default",
    });
    expect(valueStockBenefit(benefit, new Map([["item:box_of_medical_supplies", 925_000]]))).toMatchObject({
      benefit_key: "item:box_of_medical_supplies",
      value: 925_000,
      source: "custom",
    });
    expect(valueStockBenefit({ description: "1x Mystery Box" }, new Map())).toMatchObject({
      benefit_key: "item:mystery_box",
      value: null,
      source: "unpriced",
    });
  });
});

describe("calculateStockInvestmentIncrement", () => {
  it("uses active stock doubling for increment shares and ROI", () => {
    const result = calculateStockInvestmentIncrement({
      requirement: 2_000_000,
      latestPrice: 887.46,
      benefitValue: 13_378_756,
      frequencyDays: 7,
      increment: 3,
    });

    expect(result.required_shares).toBe(8_000_000);
    expect(result.total_shares_required).toBe(14_000_000);
    expect(result.increment_cost).toBeCloseTo(7_099_680_000);
    expect(result.total_cost).toBeCloseTo(12_424_440_000);
    expect(result.annual_return).toBeCloseTo(697_606_562.86);
    expect(result.roi_percent).toBeCloseTo(9.83);
  });
});
