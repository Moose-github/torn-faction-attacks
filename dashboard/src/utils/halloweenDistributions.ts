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

export type HalloweenTreatReturnPart = {
  id: number; label: string; treats: number; per25: number | null;
};
export type HalloweenTreatReturnRegion = HalloweenTreatReturnPart & {
  x: number; y: number; width: number; height: number;
};
const returnLabels = ["Original energy", "First returns", "Second returns", "Third returns", "Fourth returns", "Fifth returns", "Later returns"];

/** Treats and rewards originating from supplied energy only, excluding Mortal Coil's entire branch. */
export function getHalloweenTreatReturnBreakdown(result: Pick<HalloweenResult,
  "sources" | "treatOrigins">) {
  if (!result.treatOrigins) throw new Error("Treat origins must be traced before drawing the return breakdown.");
  const suppliedEnergy = result.sources.filter(source => source.name !== "Dark Power returns" && source.name !== "Revitalize returns")
    .reduce((sum, source) => sum + source.energy, 0);
  const per25 = (amount: number) => suppliedEnergy > 0 ? amount / suppliedEnergy * 25 : null;
  const parts: HalloweenTreatReturnPart[] = result.treatOrigins.energyRounds.map((treats, id) => ({ id, label: returnLabels[id], treats, per25: per25(treats) }));
  const energyTreats = result.treatOrigins.energyRounds.reduce((sum, amount) => sum + amount, 0);
  const regions: HalloweenTreatReturnRegion[] = [];
  if (energyTreats > 0) {
    let x = 0, width = 1, height = 1, remaining = energyTreats;
    const positive = parts.filter(part => part.treats > 0);
    positive.forEach((part, index) => {
      const fraction = index === positive.length - 1 ? 1 : Math.min(1, part.treats / remaining);
      if (index % 2 === 0) {
        const slice = width * fraction;
        regions.push({ ...part, x, y: 0, width: slice, height });
        x += slice; width -= slice;
      } else {
        const slice = height * fraction;
        regions.push({ ...part, x, y: height - slice, width, height: slice });
        height -= slice;
      }
      remaining -= part.treats;
    });
  }
  return { suppliedEnergy, parts, regions, freebieRewards: result.treatOrigins.energyFreebieRewards,
    exchangedPer25: per25(energyTreats), rewardsPer25: per25(energyTreats + result.treatOrigins.energyFreebieRewards) };
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
