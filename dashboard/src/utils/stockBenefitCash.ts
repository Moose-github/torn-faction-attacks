import type { StockInvestmentRecommendationRow } from "./stockRecommendations";

type StockBenefitIdentity = Pick<StockInvestmentRecommendationRow, "investment_type" | "benefit_key" | "benefit_description">;

/** Custom valuations of personal resources are useful ROI comparisons, not spendable cash. */
export function isNonCashStockBenefit(row: StockBenefitIdentity): boolean {
  if (row.investment_type !== "stock") return false;
  const key = (row.benefit_key ?? "").toLowerCase();
  if (/^item:(?:\d+_)?(?:energy|nerve|happy|happiness)$/.test(key)
    || /^item:ammunition_pack(?:_special_ammo)?$/.test(key)) return true;

  // Match the whole reward, so tradable energy drinks and other supply packs
  // retain their sale values. BAG's ammunition pack grants special ammo for
  // the equipped weapon; it is not a tradable supply-pack item.
  // Benefit definitions: https://wiki.torn.com/wiki/Stock
  const reward = row.benefit_description.trim().replace(/^\+?\d[\d,]*(?:\.\d+)?\s*(?:x\s*)?/i, "").trim();
  return /^(?:energy|nerve|happy|happiness|ammunition pack(?:\s*\(special ammo\))?)$/i.test(reward);
}
