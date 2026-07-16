import { describe, expect, it } from "vitest";
import {
  autoRefreshStockBenefitItemPrices,
  bankInterestBonusStockInvestmentRoiRow,
  calculateStockInvestmentIncrement,
  cityBankInvestmentRoiRow,
  parseActiveStockBenefit,
  parseBenefitDescription,
  parseStockBenefitForValuation,
  getStockInvestmentRoi,
  stockBenefitMarketValueFromResponse,
  stockBenefitPointsValueFromResponse,
  updateStockBenefitDisabledStockFromRequest,
  valueStockBenefit,
} from "./stockMarket";
import type { Env } from "./types";

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

  it("allows passive benefit JSON without a payout frequency", () => {
    expect(parseStockBenefitForValuation(JSON.stringify({
      passive: true,
      frequency: 0,
      requirement: 1_500_000,
      description: "a 10% bank interest bonus",
    }))).toEqual({
      status: "benefit",
      benefit: {
        passive: true,
        frequency: 1,
        requirement: 1_500_000,
        description: "a 10% bank interest bonus",
      },
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
  it("latches automatic benefit price refreshes for three hours", async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              name: "auto_stock_benefit_item_prices",
              last_started: 10_000,
              active_war_id: null,
              war_state: "none",
            }),
          }),
        }),
      },
    };

    const result = await autoRefreshStockBenefitItemPrices(env as any, { now: 10_600 });

    expect(result).toMatchObject({
      ok: true,
      latched: true,
      retry_after_seconds: 10_200,
      refreshed: 0,
      failed: 0,
    });
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.prices).toEqual([]);
  });

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

describe("cityBankInvestmentRoiRow", () => {
  it("returns the 90-day City Bank baseline comparison row", () => {
    const row = cityBankInvestmentRoiRow();

    expect(row).toMatchObject({
      investment_type: "city_bank",
      row_id: "city_bank:90",
      stock_id: null,
      acronym: "BANK",
      name: "City Bank",
      frequency_days: 90,
      increment_cost: 2_000_000_000,
      total_cost: 2_000_000_000,
      annual_return: 928_200_000,
    });
    expect(row.roi_percent).toBeCloseTo(46.41);
    expect(row.days_to_break_even).toBeCloseTo(2_000_000_000 / (928_200_000 / 365));
  });
});

describe("bankInterestBonusStockInvestmentRoiRow", () => {
  it("values the TCI bank interest bonus from City Bank interest", () => {
    const row = bankInterestBonusStockInvestmentRoiRow(
      { stock_id: 9, acronym: "TCI", name: "Torn City Investments" },
      { requirement: 1_500_000, description: "a 10% bank interest bonus" },
      900,
    );

    expect(row).toMatchObject({
      investment_type: "stock",
      row_id: "stock:9:1",
      stock_id: 9,
      acronym: "TCI",
      increment: 1,
      required_shares: 1_500_000,
      total_shares_required: 1_500_000,
      increment_cost: 1_350_000_000,
      total_cost: 1_350_000_000,
      benefit_key: "city_bank:tci_bonus",
      benefit_description: "10% City Bank interest bonus",
      valuation_source: "cash",
      frequency_days: 90,
      annual_return: 92_820_000,
    });
    expect(row?.benefit_value).toBeCloseTo(22_887_123.29);
    expect(row?.roi_percent).toBeCloseTo(6.8756);
  });

  it("ignores passive benefits that are not bank interest bonuses", () => {
    expect(bankInterestBonusStockInvestmentRoiRow(
      { stock_id: 10, acronym: "ZZZ", name: "Other Stock" },
      { requirement: 1_000_000, description: "some other passive bonus" },
      900,
    )).toBeNull();
  });
});

describe("stock benefit disabled stocks", () => {
  it("excludes disabled unpriced stocks from ROI rows and missing counts", async () => {
    const db = new StockBenefitTestD1();
    db.disabledStocks.set(1, {
      torn_user_id: 12345,
      stock_id: 1,
      benefit_key: "item:mystery_box",
      updated_at: 1_800_000_000,
    });
    const response = await getStockInvestmentRoi({ DB: db as unknown as D1Database } as Env, 12345);
    const body = await response.json() as {
      rows: Array<{ stock_id: number | null }>;
      skipped: { disabled: number; unpriced: number };
    };

    expect(body.skipped).toMatchObject({ disabled: 1, unpriced: 0 });
    expect(body.rows.some((row) => row.stock_id === 1)).toBe(false);
    expect(body.rows.some((row) => row.stock_id === 2)).toBe(true);
  });

  it("allows disabling an individual unpriced stock benefit", async () => {
    const db = new StockBenefitTestD1();
    const response = await updateStockBenefitDisabledStockFromRequest(
      new Request("https://worker.test/api/stocks/benefit-disabled-stocks/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      }),
      { DB: db as unknown as D1Database } as Env,
      12345,
      1,
    );
    const body = await response.json() as { ok: boolean; disabled_stocks: Array<{ stock_id: number }> };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(db.disabledStocks.get(1)).toMatchObject({
      stock_id: 1,
      benefit_key: "item:mystery_box",
    });
    expect(body.disabled_stocks).toEqual([
      expect.objectContaining({ stock_id: 1, benefit_key: "item:mystery_box" }),
    ]);
  });

  it("rejects disabling a priced/default-backed stock benefit", async () => {
    const db = new StockBenefitTestD1();
    const response = await updateStockBenefitDisabledStockFromRequest(
      new Request("https://worker.test/api/stocks/benefit-disabled-stocks/2", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      }),
      { DB: db as unknown as D1Database } as Env,
      12345,
      2,
    );
    const body = await response.json() as { ok: boolean; code: string };

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "STOCK_BENEFIT_NOT_DISABLEABLE",
    });
    expect(db.disabledStocks.size).toBe(0);
  });

  it("re-enables a disabled stock benefit", async () => {
    const db = new StockBenefitTestD1();
    db.disabledStocks.set(1, {
      torn_user_id: 12345,
      stock_id: 1,
      benefit_key: "item:mystery_box",
      updated_at: 1_800_000_000,
    });
    const response = await updateStockBenefitDisabledStockFromRequest(
      new Request("https://worker.test/api/stocks/benefit-disabled-stocks/1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: false }),
      }),
      { DB: db as unknown as D1Database } as Env,
      12345,
      1,
    );
    const body = await response.json() as { ok: boolean; disabled_stocks: unknown[] };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, disabled_stocks: [] });
    expect(db.disabledStocks.size).toBe(0);
  });
});

type StockBenefitTestProfile = {
  stock_id: number;
  acronym: string;
  name: string;
  current_price: number;
  benefit_json: string;
  benefit_key: string;
  benefit_label: string;
  benefit_market_type: string | null;
  benefit_torn_item_id: number | null;
  benefit_quantity: number | null;
  latest_price: number;
  latest_observed_at: number;
};

type StockBenefitTestDisabledStock = {
  torn_user_id: number;
  stock_id: number;
  benefit_key: string;
  updated_at: number;
};

class StockBenefitTestD1Statement {
  private args: unknown[] = [];

  constructor(
    private readonly db: StockBenefitTestD1,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): D1PreparedStatement {
    this.args = args;
    return this as unknown as D1PreparedStatement;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.db.all<T>(this.sql, this.args);
  }

  async first<T = unknown>(): Promise<T | null> {
    return this.db.first<T>(this.sql);
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    return this.db.run<T>(this.sql, this.args);
  }
}

class StockBenefitTestD1 {
  readonly profiles: StockBenefitTestProfile[] = [
    {
      stock_id: 1,
      acronym: "MYS",
      name: "Mystery Boxes",
      current_price: 100,
      benefit_json: JSON.stringify({
        passive: false,
        frequency: 7,
        requirement: 100,
        description: "1x Mystery Box",
      }),
      benefit_key: "item:mystery_box",
      benefit_label: "Mystery Box",
      benefit_market_type: null,
      benefit_torn_item_id: null,
      benefit_quantity: null,
      latest_price: 100,
      latest_observed_at: 1_800_000_000,
    },
    {
      stock_id: 2,
      acronym: "BMS",
      name: "Medical Supplies",
      current_price: 100,
      benefit_json: JSON.stringify({
        passive: false,
        frequency: 7,
        requirement: 100,
        description: "1x Box of Medical Supplies",
      }),
      benefit_key: "item:box_of_medical_supplies",
      benefit_label: "Box of Medical Supplies",
      benefit_market_type: null,
      benefit_torn_item_id: null,
      benefit_quantity: null,
      latest_price: 100,
      latest_observed_at: 1_800_000_000,
    },
  ];

  readonly disabledStocks = new Map<number, StockBenefitTestDisabledStock>();

  prepare(sql: string): D1PreparedStatement {
    return new StockBenefitTestD1Statement(this, compactSql(sql)) as unknown as D1PreparedStatement;
  }

  all<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    if (sql.includes("FROM stock_profiles p")) {
      return d1Result(this.profiles as T[]);
    }
    if (sql.includes("FROM stock_benefit_value_overrides")) {
      return d1Result([]);
    }
    if (sql.includes("FROM stock_benefit_item_prices")) {
      return d1Result([]);
    }
    if (sql.includes("FROM stock_benefit_disabled_stocks d")) {
      const tornUserId = Number(args[0]);
      const rows = [...this.disabledStocks.values()]
        .filter((stock) => stock.torn_user_id === tornUserId)
        .map((stock) => {
          const profile = this.profiles.find((candidate) => candidate.stock_id === stock.stock_id);
          return {
            stock_id: stock.stock_id,
            benefit_key: stock.benefit_key,
            disabled_at: stock.updated_at,
            acronym: profile?.acronym ?? null,
            name: profile?.name ?? null,
            benefit_label: profile?.benefit_label ?? null,
          };
        });
      return d1Result(rows as T[]);
    }

    throw new Error(`Unhandled all query: ${sql}`);
  }

  first<T = unknown>(sql: string): T | null {
    if (sql.includes("MAX(fetched_at)")) {
      return { latest_fetched_at: null } as T;
    }

    throw new Error(`Unhandled first query: ${sql}`);
  }

  run<T = unknown>(sql: string, args: unknown[]): D1Result<T> {
    if (sql.startsWith("INSERT INTO stock_benefit_disabled_stocks")) {
      this.disabledStocks.set(Number(args[1]), {
        torn_user_id: Number(args[0]),
        stock_id: Number(args[1]),
        benefit_key: String(args[2]),
        updated_at: 1_800_000_001,
      });
      return d1Result([], 1);
    }
    if (sql.startsWith("DELETE FROM stock_benefit_disabled_stocks")) {
      const stockId = Number(args[1]);
      const changed = this.disabledStocks.delete(stockId) ? 1 : 0;
      return d1Result([], changed);
    }

    throw new Error(`Unhandled run query: ${sql}`);
  }
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function d1Result<T>(results: T[], changes = 0): D1Result<T> {
  return {
    results,
    success: true,
    meta: {
      changes,
    },
  } as unknown as D1Result<T>;
}
