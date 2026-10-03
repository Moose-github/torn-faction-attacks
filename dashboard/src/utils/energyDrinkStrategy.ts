import {
  calculateBookStrategy, normalizeInputs, statAfterTrainingEnergy,
  type BookStrategyInputs, type FhcPlan,
} from "./bookStrategy";

export const ENERGY_DRINK_TIERS = [
  { energy: 5, name: "Goose Juice", price: "250k" },
  { energy: 10, name: "Damp Valley", price: "500k" },
  { energy: 15, name: "Crocozade", price: "800k" },
  { energy: 20, name: "Munster / Santa Shooters", price: "1.25m" },
  { energy: 25, name: "Red Cow / Rockstar Rudolph", price: "1.75m" },
  { energy: 30, name: "Taurine Elite / X-MASS", price: "3m" },
] as const;

export type DrinkCompany = "none" | "grocery3" | "grocery7" | "restaurant10";
export type EnergyDrinkSettings = {
  factionPercent: number;
  company: DrinkCompany;
  maxCooldownHours: number;
  startingCooldownHours: number;
  spendingCap: number | null;
};

export type EnergyDrinkForm = {
  scenario: "training" | "halloween";
  treatPrice: string;
  factionPercent: string;
  company: DrinkCompany;
  maxCooldownHours: string;
  startingCooldownHours: string;
  spendingCap: string;
  capEnabled: boolean;
  prices: string[];
  selectedTier: number;
};

export const DEFAULT_DRINK_FORM: EnergyDrinkForm = {
  scenario: "training", treatPrice: "750k",
  factionPercent: "50", company: "none", maxCooldownHours: "48",
  startingCooldownHours: "0", spendingCap: "1b", capEnabled: false,
  prices: ENERGY_DRINK_TIERS.map((tier) => tier.price), selectedTier: 5,
};

// Mechanics: https://wiki.torn.com/wiki/Energy_Drink, /Grocery_Store, /Restaurant.
// No event bonus is assumed. Round the combined can effect once, after modifiers.
export function drinkEnergy(base: number, settings: EnergyDrinkSettings, book: boolean): number {
  const companyMultiplier = settings.company === "grocery7" ? 1.1 : 1;
  return Math.round(base * (1 + settings.factionPercent / 100) * companyMultiplier * (book ? 2 : 1));
}

export function drinkCooldownHours(company: DrinkCompany): number {
  return company === "restaurant10" ? 1.5 : company === "none" ? 2 : 1.8;
}

export function calculateDrinkPlan(base: number, price: number, settings: EnergyDrinkSettings): FhcPlan {
  const cooldown = drinkCooldownHours(settings.company);
  const availableHours = settings.maxCooldownHours - settings.startingCooldownHours;
  const affordable = settings.spendingCap === null ? Infinity : Math.floor(settings.spendingCap / price);
  // Fill available cooldown at time zero, then use each can as soon as its full
  // cooldown fits. The 31-day window is half-open: no can at/after expiry.
  const initialFhcs = Math.min(affordable, Math.floor((availableHours + 1e-9) / cooldown));
  const useTimesHours = Array<number>(initialFhcs).fill(0);
  const firstNext = (initialFhcs + 1) * cooldown - availableHours;
  for (let next = firstNext; next < 744 - 1e-9 && useTimesHours.length < affordable; next += cooldown) {
    useTimesHours.push(Math.max(0, next));
  }
  return {
    initialFhcs, furtherFhcs: useTimesHours.length - initialFhcs,
    totalFhcs: useTimesHours.length, useTimesHours,
    energy: useTimesHours.length * drinkEnergy(base, settings, true),
    cost: useTimesHours.length * price,
  };
}

export function calculateEnergyDrinkTier(raw: BookStrategyInputs, base: number, price: number, settings: EnergyDrinkSettings) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const plan = calculateDrinkPlan(base, price, settings);
  const inputs = normalizeInputs({
    ...raw, bookBonusPercent: 0, bookDurationDays: 31,
    fhcEnergy: drinkEnergy(base, settings, true), fhcPrice: price,
    fhcCooldownHours: drinkCooldownHours(settings.company),
    maxBoosterCooldownHours: settings.maxCooldownHours,
  });
  const searchDays = 3650;
  const maxBudget = plan.cost * (inputs.investmentEnabled ? (1 + inputs.annualRoiPercent / 100) ** (searchDays / 365) : 1);
  if (!Number.isFinite(maxBudget) || maxBudget / inputs.statEnhancerPrice > 10_000) return null;
  const strategy = calculateBookStrategy(inputs, plan, searchDays);
  const normalEnergy = inputs.startingEnergy + inputs.dailyEnergy * 31;
  const noBookEnergy = plan.totalFhcs * drinkEnergy(base, settings, false);
  const sameCansWithoutBookStat = statAfterTrainingEnergy(inputs, normalEnergy + noBookEnergy);
  return {
    base, price, plan, inputs, strategy, searchDays,
    energyPerCan: inputs.fhcEnergy,
    bookOnlyGain: strategy.bookEnd.strategyOneStat - sameCansWithoutBookStat,
    gainPerBillion: plan.cost > 0 ? strategy.bookEnd.lead / plan.cost * 1e9 : 0,
    unspentCap: settings.spendingCap === null ? null : settings.spendingCap - plan.cost,
  };
}

export type EnergyDrinkTierResult = NonNullable<ReturnType<typeof calculateEnergyDrinkTier>>;
