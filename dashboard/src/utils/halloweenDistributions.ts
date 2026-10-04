import type { HalloweenResult } from "./halloweenProfit";

/** Separate attack drops from hourly treats and exchange bonuses, without double counting. */
export function getHalloweenTreatSources(result: Pick<HalloweenResult,
  "treatDrops" | "earnedTreats" | "cashbackTreats" | "rewardTreats" | "exchangedTreats">) {
  const attacks = result.treatDrops.reduce((sum, drop) => sum + drop.treats * drop.attacks, 0);
  return {
    attacks,
    mortalCoil: Math.max(0, result.earnedTreats - attacks),
    cashback: result.cashbackTreats,
    freebie: Math.max(0, result.rewardTreats - result.exchangedTreats),
  };
}

export type HalloweenProfitBin = {
  lower: number; upper: number; midpoint: number; count: number; percentage: number;
};

/** Equal-width bins include the maximum in the final bin; each run appears once. */
export function getHalloweenProfitDistribution(samples: readonly number[]) {
  if (!samples.length || samples.some(value => !Number.isFinite(value))) {
    throw new Error("Profit distribution requires finite simulation results.");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const minimum = sorted[0], maximum = sorted[sorted.length - 1];
  const middle = (sorted.length - 1) / 2;
  const median = (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
  const binCount = minimum === maximum ? 1 : Math.min(12, Math.ceil(Math.sqrt(samples.length)));
  const width = (maximum - minimum) / binCount;
  const bins: HalloweenProfitBin[] = Array.from({ length: binCount }, (_, index) => {
    const lower = minimum + width * index;
    const upper = index === binCount - 1 ? maximum : minimum + width * (index + 1);
    return { lower, upper, midpoint: (lower + upper) / 2, count: 0, percentage: 0 };
  });
  for (const value of samples) {
    const index = width === 0 ? 0 : Math.min(binCount - 1, Math.floor((value - minimum) / width));
    bins[index].count++;
  }
  bins.forEach(bin => { bin.percentage = bin.count / samples.length * 100; });
  return { bins, median, minimum, maximum };
}
