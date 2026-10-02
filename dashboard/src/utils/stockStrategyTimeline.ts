import { cityBankPrincipal, type OwnedStockSnapshot } from "./ownedStocks";
import { applyImportedCityBankReturn, bankReturnProtectedStockIds } from "./cityBankValuation";
import {
  DEFAULT_STOCK_STRATEGY_STEP_LIMIT, isFhgTciHybridRow, nextScheduledStockStrategyStep, recommendStockBuys,
  type StockBuyRecommendation, type StockBuyRecommendationInput, type StockInvestmentRecommendationRow, type StockStrategySale, type StockStrategyStep,
} from "./stockRecommendations";

const DAY = 86_400;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;
const TCI = "city_bank:tci_bonus";
const EPSILON = 0.00001;
const MAX_RECOMMENDATIONS = 9;
const MAX_SAVINGS_TARGETS = 2;

export type StockStrategyPayout = {
  id: string; label: string; at: number; amount: number; reward_count: number; estimated: boolean;
  basis?: "imported_bank" | "generic_bank";
};
export type StockStrategyFundingSource = {
  id: string; label: string; amount: number; reward_count: number; payout_count: number;
  first_at: number; last_at: number; estimated: boolean; averaged: boolean;
  basis?: "imported_bank" | "generic_bank";
  confirmed_amount: number;
  estimated_amount: number;
};
export type StockStrategyFunding = {
  starting_cash: number;
  sales: StockStrategySale[];
  investment_income: number;
  investment_income_sources: StockStrategyFundingSource[];
  payouts: StockStrategyPayout[];
  additional_income: number;
  total_available: number;
  purchase_cost: number;
  ending_cash: number;
};
export type StockStrategyTiming = {
  step: StockStrategyStep;
  savings_target: StockBuyRecommendation;
  purchase_at: number | null;
  status: "scheduled" | "unfunded" | "horizon";
  wait_weeks: number | null;
  elapsed_weeks: number | null;
  weekly_investment_income_after: number | null;
  weekly_total_income_after: number | null;
  funding: StockStrategyFunding | null;
};
export type StockStrategySavingsTarget = {
  recommendation: StockBuyRecommendation;
  cash_shortfall: number;
  purchase_at: number | null;
  status: "scheduled" | "unfunded" | "horizon" | "not_scheduled";
};
export type StockStrategyForecast = {
  as_of: number | null;
  issues: string[];
  warnings: string[];
  weekly_investment_income: number | null;
  timeline: StockStrategyTiming[];
  savings_target: StockStrategySavingsTarget | null;
};
export type StockStrategyTimelineInput = StockBuyRecommendationInput & {
  /** Unix seconds; supplied by the caller so simulation is deterministic. */
  asOf: number;
  additionalIncomePerWeek: number;
  privateIslandCount?: number;
};

type StockRow = StockInvestmentRecommendationRow & { stock_id: number; increment: number; total_shares_required: number };
type StockSchedule = {
  rows: StockRow[]; increment: number; frequency: number; next: number; cycleStart: number; passive: boolean;
};
type BankSchedule = { principal: number; duration: number; next: number; profit: number; estimated: boolean };

export function annualIncomeToWeekly(annualIncome: number): number { return annualIncome * 7 / 365; }

/** Schedule payout events, retain surplus cash and select sales only at execution. */
export function buildStockStrategyTimeline(input: StockStrategyTimelineInput, limit = DEFAULT_STOCK_STRATEGY_STEP_LIMIT): StockStrategyForecast {
  const snapshot = input.ownedSnapshot;
  const result: StockStrategyForecast = { as_of: snapshot?.refreshed_at || null, issues: [], warnings: [], weekly_investment_income: null, timeline: [], savings_target: null };
  if (!snapshot || snapshot.refreshed_at <= 0 || utcDay(snapshot.refreshed_at) !== utcDay(input.asOf) || snapshot.refreshed_at > input.asOf) {
    result.issues.push("Refresh owned stocks today (UTC) to calculate payout dates. Historical collections are not assumed.");
    return result;
  }
  if (snapshot.city_bank === undefined) result.issues.push("Refresh owned stocks to load City Bank details before forecasting; the bank request may have failed.");
  if (input.cityBankActive && snapshot.city_bank === null) result.issues.push("City Bank is marked active, but the API reports no deposit. Clear the active setting or refresh owned stocks.");
  const rows = input.rows.filter((row) => !isFhgTciHybridRow(row)).map((row) => applyImportedCityBankReturn(row, snapshot.city_bank));
  const protectedIds = bankReturnProtectedStockIds(rows, snapshot.city_bank);
  const lockedStockIds = new Set([...(input.lockedStockIds ?? []), ...protectedIds]);
  const stockRows = new Map<number, StockRow[]>();
  for (const row of rows) {
    if (row.stock_id !== null && row.increment !== null && row.total_shares_required !== null) {
      stockRows.set(row.stock_id, [...(stockRows.get(row.stock_id) ?? []), row as StockRow]);
    }
  }
  for (const group of stockRows.values()) group.sort((a, b) => a.increment - b.increment);
  const holdings = new Map(snapshot.stocks.map((position) => [position.stock_id, position.shares]));
  const schedules = new Map<number, StockSchedule>();
  const start = snapshot.refreshed_at;
  let now = start;
  const end = start + 5 * YEAR;
  let cash = nonNegative(input.budget ?? 0);
  let openingCash = cash;
  let previousPurchase = start;
  let additional = 0;
  let payouts: StockStrategyPayout[] = [];
  let sources = new Map<string, StockStrategyFundingSource>();
  const weeklyAdditional = nonNegative(input.additionalIncomePerWeek);
  const rentalRow = rows.find((row) => row.investment_type === "private_island");
  let rentalAnnual = (rentalRow?.annual_return ?? 0) * nonNegative(input.privateIslandCount ?? 0);
  const bankRow = rows.find((row) => row.investment_type === "city_bank");
  const importedBank = snapshot.city_bank;
  let bank: BankSchedule | null = importedBank ? {
    principal: cityBankPrincipal(importedBank), duration: importedBank.duration, next: Math.max(start, importedBank.until),
    profit: importedBank.profit, estimated: false,
  } : null;

  const coveredIncrement = (id: number) => Math.max(0, ...(stockRows.get(id) ?? [])
    .filter((row) => (holdings.get(id) ?? 0) >= row.total_shares_required).map((row) => row.increment));
  const payoutValue = (schedule: StockSchedule) => schedule.rows.filter((row) => row.increment <= schedule.increment)
    .reduce((total, row) => total + row.benefit_value, 0);

  for (const position of snapshot.stocks) {
    const group = stockRows.get(position.stock_id);
    if (!group) continue; // Unvalued/passive benefits are not cash sources in the ROI table.
    if (importedBank && group[0].benefit_key === TCI) continue; // The imported bank return already contains any applied bonuses.
    const count = coveredIncrement(position.stock_id);
    if (!count) continue;
    const bonus = position.bonus;
    const passive = group[0].benefit_key === TCI;
    const ready = bonus?.available === true || Boolean(passive && bonus && bonus.progress !== null && bonus.frequency !== null && bonus.progress === bonus.frequency);
    const frequency = bonus?.frequency ?? (ready ? (passive ? 7 : group[0].frequency_days) : null);
    if (!bonus || (!passive && (bonus.increment === null || bonus.increment <= 0 || bonus.increment > count)) || frequency === null || frequency <= 0
      || (!ready && (bonus.progress === null || bonus.progress < 0 || bonus.progress >= frequency || (!passive && bonus.available === null)))) {
      result.issues.push(`${group[0].acronym ?? group[0].name}: payout timing is missing or incompatible with these holdings. Refresh owned stocks and clear conflicting manual ownership.`);
      continue;
    }
    schedules.set(position.stock_id, {
      rows: group, increment: passive ? count : bonus.increment!, frequency, passive,
      cycleStart: utcDay(start) - (bonus.progress ?? 0) * DAY,
      next: ready ? (passive ? Infinity : start) : utcDay(start) + (frequency - bonus.progress!) * DAY,
    });
  }
  if (input.rows.some(isFhgTciHybridRow) || input.fhgTciHybridActive) result.warnings.push("The FHG/TCI hybrid is excluded. FHG rewards and bank returns are modelled separately.");
  if (rentalAnnual > 0) result.warnings.push("Private Island rent is an averaged estimate; stock rewards and bank interest use payout dates.");
  if (importedBank && protectedIds.some((id) => (holdings.get(id) ?? 0) > 0)) result.warnings.push("The bank forecast repeats your imported return without adding TCI again. Owned TCI is kept while assuming the same bank bonuses.");
  if (result.issues.length) return result;

  function estimatedBankProfit(principal: number, duration: number): number {
    if (importedBank) return importedBank.profit;
    let annual = bankRow?.annual_return ?? 0;
    for (const [id, schedule] of schedules) {
      if (schedule.passive && coveredIncrement(id) > 0 && schedule.next === Infinity) annual += schedule.rows[0].annual_return;
    }
    return annual * principal / (bankRow?.increment_cost || 1) * duration / 365;
  }
  function weeklyIncome(): number {
    let annual = rentalAnnual;
    for (const [id, schedule] of schedules) {
      if (!schedule.passive) annual += schedule.rows.filter((row) => row.increment <= coveredIncrement(id))
        .reduce((total, row) => total + row.benefit_value * 365 / schedule.frequency, 0);
    }
    if (bank) annual += bank.profit * 365 / bank.duration;
    return annualIncomeToWeekly(annual);
  }
  function credit(event: StockStrategyPayout, averaged = false): void {
    if (event.amount <= 0) return;
    cash += event.amount;
    if (!averaged) payouts.push(event);
    const old = sources.get(event.id);
    sources.set(event.id, {
      id: event.id, label: event.label, amount: (old?.amount ?? 0) + event.amount,
      reward_count: (old?.reward_count ?? 0) + event.reward_count,
      payout_count: (old?.payout_count ?? 0) + (averaged ? 0 : 1),
      first_at: old?.first_at ?? event.at, last_at: event.at,
      estimated: (old?.estimated ?? false) || event.estimated, averaged,
      basis: event.basis,
      confirmed_amount: (old?.confirmed_amount ?? 0) + (event.estimated ? 0 : event.amount),
      estimated_amount: (old?.estimated_amount ?? 0) + (event.estimated ? event.amount : 0),
    });
  }
  function processPayouts(): void {
    // Passive activation happens before a bank renewal at the same timestamp.
    for (const schedule of schedules.values()) if (schedule.passive && schedule.next <= now) schedule.next = Infinity;
    for (const [id, schedule] of schedules) {
      if (schedule.passive || schedule.next > now) continue;
      const row = schedule.rows[0];
      credit({ id: `stock:${id}`, label: `${row.acronym ?? row.name}: ${row.benefit_description.replace(/^1x\s+/i, "")}`,
        at: now, amount: payoutValue(schedule), reward_count: schedule.increment, estimated: true });
      schedule.increment = coveredIncrement(id);
      schedule.cycleStart = utcDay(now);
      schedule.next = schedule.cycleStart + schedule.frequency * DAY;
    }
    if (bank && bank.next <= now) {
      credit({ id: "city_bank", label: "City Bank interest", at: now, amount: bank.profit, reward_count: 1, estimated: bank.estimated,
        basis: importedBank ? "imported_bank" : "generic_bank" });
      bank.profit = estimatedBankProfit(bank.principal, bank.duration);
      bank.next = now + bank.duration * DAY;
      bank.estimated = true;
    }
  }
  function refreshSchedule(id: number, purchase: boolean): void {
    const count = coveredIncrement(id);
    const old = schedules.get(id);
    if (!count) { schedules.delete(id); return; }
    const group = stockRows.get(id)!;
    if (!old || (!purchase && count < old.increment)) {
      const passive = group[0].benefit_key === TCI;
      const frequency = passive ? 7 : group[0].frequency_days;
      schedules.set(id, { rows: group, increment: count, passive, frequency,
        cycleStart: utcDay(now), next: utcDay(now) + frequency * DAY });
      if (old) result.warnings.push(`${group[0].acronym ?? group[0].name}: a sale interrupts the active entitlement; the remaining cycle is conservatively restarted.`);
    } else if (purchase && !old.passive && utcDay(now) === old.cycleStart) {
      // No daily progress in the cycle yet: new blocks join this cycle.
      old.increment = count;
    }
  }
  result.weekly_investment_income = weeklyIncome();
  const completed: StockStrategyStep[] = [];
  while (result.timeline.length < limit) {
    processPayouts();
    const currentSnapshot: OwnedStockSnapshot = { ...snapshot, stocks: [...holdings].map(([stock_id, shares]) => ({ stock_id, shares, bonus: null })) };
    const stepInput = { ...input, rows: bank && !importedBank ? rows : rows.filter((row) => row.benefit_key !== TCI), lockedStockIds,
      ownedSnapshot: currentSnapshot, cityBankActive: bank !== null, budget: cash, fhgTciHybridActive: false,
      fhgTciHybridBaselineShares: undefined, fhgTciHybridReservedShares: undefined };
    const proposed = nextScheduledStockStrategyStep(stepInput, completed, limit);
    if (!proposed) break;
    if (!result.savings_target) result.savings_target = {
      recommendation: proposed.savings_target,
      cash_shortfall: Math.max(0, proposed.savings_target.estimated_cost - cash),
      purchase_at: null, status: "not_scheduled",
    };
    if (proposed.extra_cash_needed > EPSILON) {
      const continuousPerSecond = weeklyAdditional / WEEK + rentalAnnual / YEAR;
      let cashTarget = cash + proposed.extra_cash_needed;
      // Re-evaluate when another candidate becomes affordable between payout events.
      for (const candidate of recommendStockBuys({ ...stepInput, affordableOnly: false, budget: null }, Number.MAX_SAFE_INTEGER)) {
        if (candidate.estimated_cost > cash + EPSILON) cashTarget = Math.min(cashTarget, candidate.estimated_cost);
      }
      // Unix-second doubles can round a tiny wait back to `now`; always advance the clock.
      const nextCash = continuousPerSecond > 0 ? Math.max(now + 0.000001, now + (cashTarget - cash) / continuousPerSecond) : Infinity;
      const nextPayout = Math.min(bank?.next ?? Infinity, ...[...schedules.values()].map((schedule) => schedule.next));
      const next = Math.min(nextCash, nextPayout);
      const futureStockIncome = [...schedules.values()].some((schedule) => !schedule.passive && schedule.rows.some((row) => row.benefit_value > 0));
      const futureBankIncome = bank && (bank.profit > 0 || (!importedBank && (bankRow?.annual_return ?? 0) > 0));
      if ((!futureStockIncome && !futureBankIncome && continuousPerSecond <= 0) || next > end || !Number.isFinite(next)) {
        result.timeline.push({ step: proposed, savings_target: proposed.savings_target, purchase_at: null, status: !futureStockIncome && !futureBankIncome && continuousPerSecond <= 0 ? "unfunded" : "horizon",
          wait_weeks: null, elapsed_weeks: null, weekly_investment_income_after: null, weekly_total_income_after: null, funding: null });
        break;
      }
      const elapsed = next - now;
      const earned = weeklyAdditional * elapsed / WEEK;
      additional += earned;
      cash += earned;
      credit({ id: "private_island:rental", label: "Private Island rental income (averaged)", at: next,
        amount: rentalAnnual * elapsed / YEAR, reward_count: 0, estimated: true }, true);
      now = next;
      continue;
    }
    const totalAvailable = cash + proposed.sales.reduce((total, sale) => total + sale.sale_value, 0);
    const step = { ...proposed, starting_cash: cash, extra_cash_needed: 0, ending_cash: Math.max(0, totalAvailable - proposed.recommendation.estimated_cost) };
    for (const sale of step.sales) {
      if (sale.stock_id === null) continue;
      holdings.set(sale.stock_id, Math.max(0, (holdings.get(sale.stock_id) ?? 0) - sale.shares));
      refreshSchedule(sale.stock_id, false);
    }
    const row = step.recommendation.row;
    if (row.stock_id !== null && step.recommendation.target_shares !== null) {
      holdings.set(row.stock_id, step.recommendation.target_shares);
      refreshSchedule(row.stock_id, true);
    } else if (row.investment_type === "city_bank") {
      bank = { principal: row.increment_cost, duration: row.frequency_days, next: now + row.frequency_days * DAY,
        profit: estimatedBankProfit(row.increment_cost, row.frequency_days), estimated: true };
    } else if (row.investment_type === "private_island") rentalAnnual += row.annual_return;
    const investmentSources = [...sources.values()];
    result.timeline.push({ step, savings_target: proposed.savings_target, purchase_at: now, status: "scheduled", wait_weeks: (now - previousPurchase) / WEEK,
      elapsed_weeks: (now - start) / WEEK, weekly_investment_income_after: weeklyIncome(),
      weekly_total_income_after: weeklyIncome() + weeklyAdditional,
      funding: { starting_cash: openingCash, sales: step.sales, investment_income: investmentSources.reduce((sum, source) => sum + source.amount, 0),
        investment_income_sources: investmentSources, payouts, additional_income: additional,
        total_available: totalAvailable, purchase_cost: step.recommendation.estimated_cost, ending_cash: step.ending_cash },
    });
    completed.push(step);
    cash = step.ending_cash;
    openingCash = cash;
    previousPurchase = now;
    additional = 0;
    payouts = [];
    sources = new Map();
  }
  groupSavingsMilestones(result.timeline);
  // Classify with the full lookahead first so a small repurchase (such as TCT)
  // is not counted as the second milestone before its larger target is known.
  let savingsTargets = 0;
  const secondTargetIndex = result.timeline.findIndex(timing =>
    timing.step.recommendation.row.row_id === timing.savings_target.row.row_id
    && ++savingsTargets === MAX_SAVINGS_TARGETS);
  result.timeline = result.timeline.slice(0, Math.min(MAX_RECOMMENDATIONS,
    secondTargetIndex < 0 ? result.timeline.length : secondTargetIndex + 1));
  if (result.savings_target) {
    const target = result.savings_target.recommendation;
    // A purchase of a later increment can also complete the initial target.
    const reached = result.timeline.find(({ step, status }) => status === "scheduled" && (
      step.recommendation.row.row_id === target.row.row_id || (
        target.row.stock_id !== null && step.recommendation.row.stock_id === target.row.stock_id
        && target.target_shares !== null && (step.recommendation.target_shares ?? 0) >= target.target_shares
      )
    ));
    const last = result.timeline[result.timeline.length - 1];
    result.savings_target.purchase_at = reached?.purchase_at ?? null;
    result.savings_target.status = reached ? "scheduled"
      : last?.status === "unfunded" || last?.status === "horizon" ? last.status : "not_scheduled";
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}

/** Keep smaller follow-up buys within the next major saving phase, without changing execution. */
function groupSavingsMilestones(timeline: StockStrategyTiming[]): void {
  let previousMilestoneCost = 0;
  for (let index = 0; index < timeline.length; index++) {
    const timing = timeline[index];
    if (timing.savings_target.estimated_cost < previousMilestoneCost) {
      // Look only at targets identified by this forecast. If it ends before a larger
      // target appears, retain the known target rather than inventing a destination.
      const nextMilestone = timeline.slice(index + 1).find(candidate =>
        candidate.savings_target.estimated_cost >= previousMilestoneCost);
      if (nextMilestone) timing.savings_target = nextMilestone.savings_target;
    }
    if (timing.status === "scheduled" && timing.step.recommendation.row.row_id === timing.savings_target.row.row_id) {
      // A completed milestone remains a milestone even if its holding is sold later.
      previousMilestoneCost = timing.step.recommendation.estimated_cost;
    }
  }
}

function utcDay(timestamp: number): number { return Math.floor(timestamp / DAY) * DAY; }
function nonNegative(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
