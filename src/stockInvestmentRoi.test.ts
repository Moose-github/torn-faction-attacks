import { describe, expect, it } from "vitest";
import {
  calculateStockInvestmentIncrement,
  parseActiveStockBenefit,
  parseBenefitDescription,
  parseStockBenefitForValuation,
  stockBenefitMarketValueFromResponse,
  stockBenefitPointsValueFromResponse,
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

  it("parses passive benefits for manual valuation rows", () => {
    expect(parseStockBenefitForValuation(JSON.stringify({
      passive: true,
      frequency: 7,
      requirement: 1_500_000,
      description: "a 10% bank interest bonus",
    }))).toEqual({
      status: "benefit",
      benefit: {
        passive: true,
        frequency: 7,
        requirement: 1_500_000,
        description: "a 10% bank interest bonus",
      },
    });
    expect(parseBenefitDescription("a 10% bank interest bonus")).toMatchObject({
      benefit_key: "item:a_10_bank_interest_bonus",
      value: null,
      editable: true,
    });
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
    expect(parseBenefitDescription("1x Random Property")).toMatchObject({
      benefit_key: "item:random_property",
      value: 45_456_058,
      editable: true,
    });
    expect(parseBenefitDescription("1x Clothing Cache")).toMatchObject({
      benefit_key: "item:clothing_cache",
      value: 5_137_999,
      editable: true,
    });
    expect(parseBenefitDescription("100 energy")).toMatchObject({
      benefit_key: "item:100_energy",
      value: null,
      editable: true,
    });
    expect(parseBenefitDescription("1x Ammunition Pack")).toMatchObject({
      benefit_key: "item:ammunition_pack",
      value: null,
      editable: true,
    });
    expect(parseBenefitDescription("50 nerve")).toMatchObject({
      benefit_key: "item:50_nerve",
      value: null,
      editable: true,
    });
    expect(parseBenefitDescription("1000 happiness")).toMatchObject({
      benefit_key: "item:1000_happiness",
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

  it("applies fetched standard values before hardcoded fallback", () => {
    const standardValues = new Map([
      ["item:drug_pack", 4_200_000],
      ["item:box_of_medical_supplies", 910_000],
      ["item:100_points", 3_113_600],
    ]);

    expect(parseBenefitDescription("2x Drug Pack", standardValues)).toMatchObject({
      benefit_key: "item:drug_pack",
      value: 8_400_000,
    });
    expect(valueStockBenefit(
      { description: "1x Box of Medical Supplies" },
      new Map(),
      standardValues,
    )).toMatchObject({
      value: 910_000,
      source: "market",
    });
    expect(valueStockBenefit(
      { description: "1x Box of Medical Supplies" },
      new Map([["item:box_of_medical_supplies", 925_000]]),
      standardValues,
    )).toMatchObject({
      value: 925_000,
      source: "custom",
    });
    expect(valueStockBenefit(
      { description: "100 points" },
      new Map(),
      standardValues,
    )).toMatchObject({
      benefit_key: "item:100_points",
      value: 3_113_600,
      source: "market",
    });
  });
});

describe("stock benefit item market values", () => {
  it("uses price at cumulative quantity five from sorted itemmarket listings", () => {
    expect(stockBenefitMarketValueFromResponse({
      itemmarket: {
        listings: [
          { cost: 1_050_000, quantity: 3 },
          { cost: 1_000_000, quantity: 1 },
          { cost: 1_100_000, quantity: 5 },
        ],
      },
    })).toBe(1_100_000);
  });

  it("falls back to the last available listing when fewer than five are listed", () => {
    expect(stockBenefitMarketValueFromResponse({
      listings: [
        { price: 10_000, amount: 1 },
        { price: 12_000, amount: 2 },
      ],
    })).toBe(12_000);
  });

  it("uses pointsmarket cost at cumulative quantity for total point benefit value", () => {
    expect(stockBenefitPointsValueFromResponse({
      pointsmarket: {
        "20709744": { cost: 31_136, quantity: 980, total_cost: 30_513_280 },
        "20709718": { cost: 31_138, quantity: 100, total_cost: 3_113_800 },
      },
    }, 100)).toBe(3_113_600);
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
