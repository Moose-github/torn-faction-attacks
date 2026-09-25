import { defaultBookStrategyInputs, gainPerTrain, perkProduct, type BookStrategyInputs } from "./bookStrategy";

export type StatEnhancerSettings = Pick<BookStrategyInputs,
  "happiness" | "gymMultiplier" | "privateIslandPercent" | "generalEducationPercent" |
  "statEducationPercent" | "steadfastPercent" | "customPerksPercent" | "statEnhancerPrice"
>;

export const MAX_RANGE_STAT = 1_000_000_000_000_000;
const ENHANCER_GAIN = 0.01;

export function gymGainPerEnergy(stat: number, settings: StatEnhancerSettings): number {
  return gainPerTrain(stat, {
    happiness: settings.happiness,
    gymMultiplier: settings.gymMultiplier,
    energyPerTrain: 1,
    bookBonusPercent: 0,
  }, perkProduct({ ...defaultBookStrategyInputs, ...settings }), false);
}

export function cashPerEnergyAtBreakEven(stat: number, settings: StatEnhancerSettings): number {
  return gymGainPerEnergy(stat, settings) * settings.statEnhancerPrice / (stat * ENHANCER_GAIN);
}

export function compareEnhancerEfficiency(stat: number, cashPerEnergy: number, settings: StatEnhancerSettings) {
  const gym = gymGainPerEnergy(stat, settings);
  const enhancer = stat * ENHANCER_GAIN * cashPerEnergy / settings.statEnhancerPrice;
  const ratio = enhancer / gym;
  const winner = Math.abs(ratio - 1) < 1e-9 ? "equal" : ratio > 1 ? "enhancer" : "gym";
  return {
    gym,
    enhancer,
    winner,
    // Relative to the less efficient method. Zero earnings have no finite percentage comparison.
    advantagePercent: winner === "equal" ? 0 : enhancer === 0 ? null : (Math.max(ratio, 1 / ratio) - 1) * 100,
    requiredCashPerEnergy: cashPerEnergyAtBreakEven(stat, settings),
  };
}

/** The required earnings decrease with stat in the shared gym model. Search in log space. */
export function findEnhancerBreakEvenStat(cashPerEnergy: number, settings: StatEnhancerSettings): number | null {
  if (cashPerEnergy <= 0 || cashPerEnergyAtBreakEven(MAX_RANGE_STAT, settings) > cashPerEnergy) return null;
  if (cashPerEnergyAtBreakEven(1, settings) <= cashPerEnergy) return 1;
  let low = 0;
  let high = Math.log10(MAX_RANGE_STAT);
  for (let index = 0; index < 64; index += 1) {
    const mid = (low + high) / 2;
    if (cashPerEnergyAtBreakEven(10 ** mid, settings) > cashPerEnergy) low = mid;
    else high = mid;
  }
  return 10 ** high;
}

export function statAtGraphPosition(position: number, minStat: number, maxStat: number): number {
  return 10 ** (Math.log10(minStat) + Math.min(1, Math.max(0, position)) * Math.log10(maxStat / minStat));
}

export function graphPositionForStat(stat: number, minStat: number, maxStat: number): number {
  return Math.log10(stat / minStat) / Math.log10(maxStat / minStat);
}
