import {
  activePostBookTrainingDaysAtDay, gainPerTrain, normalizeInputs, perkProduct,
  statAfterTrainingEnergy, type BookStrategyInputs,
} from "./bookStrategy";
import { calculateDrinkPlan, drinkEnergy, type EnergyDrinkSettings } from "./energyDrinkStrategy";

export const HALLOWEEN_DAYS = 7;
export const HALLOWEEN_SEARCH_DAYS = 3650;
const ATTACK_ENERGY = 25;
const FREEBIE = 1.1;
const CASHBACK = 0.1;
const DARK_POWER_ENERGY = 5;
// Nightmarish, scary clothing + finishing weapon, all multiplier upgrades,
// and Cat in Hell's expected 1,000 / 500,000 treats per attack.
// Sources: https://wiki.torn.com/wiki/Trick_or_Treat
// https://www.torn.com/forums.php?p=threads&f=61&t=16504610
export const MAX_BASKET_TREATS_PER_ATTACK = 1.2 * 1.2 * 1.15 * 1.04 + 1000 / 500000;

/** Expected values with frequent exchanges and all returned energy attacked.
 * Freebie applies to both item rewards and Dark Power; Cashback returns 10%
 * of the original exchange. No held inventory means no Inflation accrual.
 */
export function expectedHalloweenRewards(energy: number, passiveHours = 0) {
  const initialTreats = energy / ATTACK_ENERGY * MAX_BASKET_TREATS_PER_ATTACK + passiveHours;
  const recycleRate = CASHBACK + FREEBIE * DARK_POWER_ENERGY / ATTACK_ENERGY * MAX_BASKET_TREATS_PER_ATTACK;
  const exchangedTreats = initialTreats / (1 - recycleRate);
  const rewardUnits = exchangedTreats * FREEBIE;
  const returnedEnergy = rewardUnits * DARK_POWER_ENERGY;
  const attacks = (energy + returnedEnergy) / ATTACK_ENERGY;
  return {
    attacks, returnedEnergy, rewardUnits, exchangedTreats,
    earnedTreats: attacks * MAX_BASKET_TREATS_PER_ATTACK + passiveHours,
    cashbackTreats: exchangedTreats * CASHBACK,
  };
}

/** Apply whole enhancers, including Torn's 5-trillion gain cap per item. */
export function halloweenEnhancedStat(stat: number, count: number): number {
  if (stat <= 0 || count <= 0) return stat;
  const capStat = 500e12;
  const percentageUses = stat >= capStat ? 0 : Math.min(count, Math.ceil(Math.log(capStat / stat) / Math.log(1.01)));
  return stat * 1.01 ** percentageUses + (count - percentageUses) * 5e12;
}

type TrainingPoint = { day: number; cansStat: number; savingsStat: number; cansTrains: number; savingsTrains: number };
export type HalloweenPoint = { day: number; cansStat: number; savingsStat: number; difference: number };

export function calculateHalloweenTier(raw: BookStrategyInputs, base: number, price: number, settings: EnergyDrinkSettings, rewardValue: number) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(rewardValue) || rewardValue < 0 || rewardValue > 1e8) return null;
  if (!validSettings(settings) || !Number.isFinite(raw.dailyEnergy) || raw.dailyEnergy < 0 || raw.dailyEnergy > 10000) return null;
  const inputs = normalizeInputs({ ...raw, bookDurationDays: 31, bookBonusPercent: 0, graphDurationDays: Math.round(raw.graphDurationDays) });
  const plan = calculateDrinkPlan(base, price, settings);
  const canEnergy = drinkEnergy(base, settings, true);
  const times = plan.useTimesHours ?? [];
  const eventCans = times.filter((hour) => hour < HALLOWEEN_DAYS * 24 - 1e-9).length;
  const eventCanEnergy = eventCans * canEnergy;
  const gymCanEnergy = plan.energy - eventCanEnergy;
  const normalEventEnergy = inputs.startingEnergy + inputs.dailyEnergy * HALLOWEEN_DAYS;
  const baselineRewards = expectedHalloweenRewards(normalEventEnergy, HALLOWEEN_DAYS * 24);
  const canRewards = expectedHalloweenRewards(normalEventEnergy + eventCanEnergy, HALLOWEEN_DAYS * 24);
  const extraRewards = expectedHalloweenRewards(eventCanEnergy);
  const baselineProceeds = baselineRewards.rewardUnits * rewardValue;
  const extraProceeds = extraRewards.rewardUnits * rewardValue;
  const canProceeds = baselineProceeds + extraProceeds;
  const growth = (days: number) => inputs.investmentEnabled ? (1 + inputs.annualRoiPercent / 100) ** (Math.max(0, days) / 365) : 1;
  const balancesAt = (day: number) => ({
    cans: day < HALLOWEEN_DAYS ? 0 : canProceeds * growth(day - HALLOWEEN_DAYS),
    savings: plan.cost * growth(day) + (day < HALLOWEEN_DAYS ? 0 : baselineProceeds * growth(day - HALLOWEEN_DAYS)),
  });
  const maxBalance = balancesAt(HALLOWEEN_SEARCH_DAYS);
  if (!Number.isFinite(maxBalance.cans + maxBalance.savings) || Math.max(maxBalance.cans, maxBalance.savings) / inputs.statEnhancerPrice > 10000) return null;

  const perks = perkProduct(inputs);
  const advance = (stat: number, trains: number) => {
    for (let index = 0; index < trains; index++) stat += gainPerTrain(stat, inputs, perks, false);
    return stat;
  };
  const before: TrainingPoint[] = [];
  let cansStat = inputs.startingStat;
  let savingsStat = inputs.startingStat;
  let cansTrains = 0;
  let savingsTrains = 0;
  let firstSavingOvertakeDay: number | null = null;
  let targetStatDay: number | null = null;

  for (let day = 0; day <= HALLOWEEN_SEARCH_DAYS; day++) {
    const normalTrainingEnergy = inputs.dailyEnergy * (
      Math.max(0, Math.min(day, 31) - HALLOWEEN_DAYS) + activePostBookTrainingDaysAtDay(inputs, day)
    );
    // All starting and ordinary energy during the event is attacked. At the
    // event boundary, cans at exactly hour 168 belong to subsequent training.
    const availableCanTrainingEnergy = day > 31 ? gymCanEnergy : times.filter((hour) => hour >= 168 - 1e-9 && hour <= day * 24 + 1e-9).length * canEnergy;
    const nextCansTrains = Math.floor((normalTrainingEnergy + availableCanTrainingEnergy + 1e-9) / inputs.energyPerTrain);
    const nextSavingsTrains = Math.floor((normalTrainingEnergy + 1e-9) / inputs.energyPerTrain);
    cansStat = advance(cansStat, nextCansTrains - cansTrains);
    savingsStat = advance(savingsStat, nextSavingsTrains - savingsTrains);
    cansTrains = nextCansTrains;
    savingsTrains = nextSavingsTrains;
    before.push({ day, cansStat, savingsStat, cansTrains, savingsTrains });
    if (day < 31) continue;
    if (inputs.enhancerUseMode.kind === "targetStat" && targetStatDay === null && savingsStat >= inputs.enhancerUseMode.stat) targetStatDay = day;
    if (firstSavingOvertakeDay === null && plan.totalFhcs > 0) {
      const cash = balancesAt(day);
      const afterCans = halloweenEnhancedStat(cansStat, Math.floor(cash.cans / inputs.statEnhancerPrice));
      const afterSavings = halloweenEnhancedStat(savingsStat, Math.floor(cash.savings / inputs.statEnhancerPrice));
      if (afterSavings - afterCans > 0.5) firstSavingOvertakeDay = day;
    }
  }

  const mode = inputs.enhancerUseMode;
  const purchaseDay = mode.kind === "earliestOvertake" ? firstSavingOvertakeDay ?? 31
    : mode.kind === "targetStat" ? targetStatDay
    : mode.day <= HALLOWEEN_SEARCH_DAYS ? Math.max(31, Math.ceil(mode.day)) : null;
  const purchaseCash = purchaseDay === null ? null : balancesAt(purchaseDay);
  const cansEnhancers = purchaseCash ? Math.floor(purchaseCash.cans / inputs.statEnhancerPrice) : 0;
  const savingsEnhancers = purchaseCash ? Math.floor(purchaseCash.savings / inputs.statEnhancerPrice) : 0;
  const purchase = {
    day: purchaseDay, cansEnhancers, savingsEnhancers,
    cansBalance: purchaseCash?.cans ?? null, savingsBalance: purchaseCash?.savings ?? null,
    cansCashLeft: purchaseCash ? purchaseCash.cans - cansEnhancers * inputs.statEnhancerPrice : null,
    savingsCashLeft: purchaseCash ? purchaseCash.savings - savingsEnhancers * inputs.statEnhancerPrice : null,
  };
  const series: HalloweenPoint[] = [];
  for (const point of before.slice(0, inputs.graphDurationDays + 1)) {
    if (purchaseDay === null || point.day < purchaseDay) {
      series.push({ day: point.day, cansStat: point.cansStat, savingsStat: point.savingsStat, difference: point.savingsStat - point.cansStat });
      continue;
    }
    if (point.day === purchaseDay) {
      // Duplicate x-value shows the purchase as a vertical jump, not a day of training.
      series.push({ day: point.day, cansStat: point.cansStat, savingsStat: point.savingsStat, difference: point.savingsStat - point.cansStat });
      cansStat = halloweenEnhancedStat(point.cansStat, cansEnhancers);
      savingsStat = halloweenEnhancedStat(point.savingsStat, savingsEnhancers);
    } else {
      const previous = before[point.day - 1];
      cansStat = advance(cansStat, point.cansTrains - previous.cansTrains);
      savingsStat = advance(savingsStat, point.savingsTrains - previous.savingsTrains);
    }
    series.push({ day: point.day, cansStat, savingsStat, difference: savingsStat - cansStat });
  }
  const bookEnd = before[31];
  const allCansTrainedStat = statAfterTrainingEnergy(inputs, inputs.dailyEnergy * 24 + plan.energy);
  return {
    base, price, rewardValue, inputs, plan, eventCans, eventCanEnergy, gymCanEnergy,
    normalEventEnergy, baselineRewards, canRewards, extraRewards,
    baselineProceeds, extraProceeds, canProceeds,
    netExtraCash: extraProceeds - plan.cost,
    bookEndGymLead: bookEnd.cansStat - bookEnd.savingsStat,
    gymGainsForgone: allCansTrainedStat - bookEnd.cansStat,
    firstSavingOvertakeDay, purchase, series, endpoint: series[series.length - 1],
    bookEnd, cashAtBookEnd: balancesAt(31),
  };
}

function validSettings(settings: EnergyDrinkSettings) {
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  return inRange(settings.factionPercent, 0, 50) && inRange(settings.maxCooldownHours, 24, 48)
    && inRange(settings.startingCooldownHours, 0, settings.maxCooldownHours)
    && (settings.spendingCap === null || inRange(settings.spendingCap, 0, 1e12));
}

export type HalloweenTierResult = NonNullable<ReturnType<typeof calculateHalloweenTier>>;
