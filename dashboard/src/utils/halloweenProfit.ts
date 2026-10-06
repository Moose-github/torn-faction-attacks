import { ENERGY_DRINK_TIERS } from "./energyDrinkStrategy";
import { HalloweenTreatOriginTracker, type HalloweenTreatOrigins } from "./halloweenTreatOrigins";
import { HalloweenUpgradeProgress } from "./halloweenUpgradePath";

export const HALLOWEEN_HOURS = 168;
export const HALLOWEEN_SIMULATION_RUNS = 128;
export const HALLOWEEN_REFINED_RUNS = 1024;
export const HALLOWEEN_TREAT_OUTCOMES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60, 120] as const;
const SIMULATION_SEED = 0x6d2b79f5;
const EVENT_MINUTES = HALLOWEEN_HOURS * 60;
const CLEANUP_START = EVENT_MINUTES - 60;
export const HALLOWEEN_BASKETS = [
  { id: "spooky", name: "Spooky", treatChance: 35 },
  { id: "creepy", name: "Creepy", treatChance: 40 },
  { id: "freaky", name: "Freaky", treatChance: 45 },
  { id: "frightful", name: "Frightful", treatChance: 50 },
  { id: "haunting", name: "Haunting", treatChance: 55 },
  { id: "shocking", name: "Shocking", treatChance: 60 },
  { id: "terrifying", name: "Terrifying", treatChance: 65 },
  { id: "horrifying", name: "Horrifying", treatChance: 70 },
  { id: "petrifying", name: "Petrifying", treatChance: 75 },
  { id: "nightmarish", name: "Nightmarish", treatChance: 80 },
  { id: "apocalyptic", name: "Apocalyptic", treatChance: 80 },
] as const;
export type HalloweenBasket = typeof HALLOWEEN_BASKETS[number]["id"];
export const HALLOWEEN_BOOKS = [
  { id: "none", name: "No book", description: "Keep your books for another event." },
  { id: "higher", name: "Higher Daddy, Higher!", description: "+20% natural energy regeneration." },
  { id: "fuel", name: "Fuelling Your Way To Failure", description: "Double energy from cans." },
  { id: "ugly", name: "Ugly Energy", description: "250 maximum energy, including FHCs and refills." },
  { id: "self", name: "Self Control Is For Losers", description: "Half can cooldown; FHC cooldown is unchanged." },
] as const;
export type HalloweenBook = typeof HALLOWEEN_BOOKS[number]["id"];
export type HalloweenCompany = "none" | "grocery3" | "grocery7" | "restaurant10" | "farm10" | "candle7" | "game10";
export const HALLOWEEN_COMPANIES: { id: HalloweenCompany; name: string; energy: number }[] = [
  { id: "none", name: "None / other", energy: 0 },
  { id: "grocery3", name: "Grocery store · 3★", energy: 0 },
  { id: "grocery7", name: "Grocery store · 7★+", energy: 0 },
  { id: "restaurant10", name: "Restaurant · 10★", energy: 3 },
  { id: "farm10", name: "Farm · 10★", energy: 7 },
  { id: "candle7", name: "Candle shop · 7★+", energy: 5 },
  { id: "game10", name: "Game shop · 10★", energy: 5 },
];
export const HALLOWEEN_BOOSTERS = [
  { id: "none", name: "No paid boosters", energy: 0 },
  { id: "fhc", name: "FHCs", energy: 0 },
  ...ENERGY_DRINK_TIERS.map(tier => ({ id: `can${tier.energy}`, name: `${tier.energy}E cans`, energy: tier.energy })),
];
export type HalloweenSettings = {
  basketLevel: HalloweenBasket;
  treatPrice: number; weapon: "scary" | "revitalize"; revitalize: number; scaryClothing: boolean; mortalCoil: boolean;
  darkPower: boolean; freebie: boolean; cashback: boolean;
  donor: boolean; company: HalloweenCompany; factionBonus: number;
  maxCooldown: number; startingCooldown: number; canPrices: number[]; fhcPrice: number;
  startingEnergy: number; specialRefills: number;
  drugPrice: number; drugInterval: number; drugDelay: number;
  jobPoints: number; dailyJobPoints: number; extraEnergy: number; greenEggs: number;
  attackCost: number; otherCost: number; startHour: number; sleepHours: number; sleepStart: number;
  exchangeHours: number; // Legacy setting; exchanges now follow the fixed batch/cap policy.
};
export const DEFAULT_HALLOWEEN: HalloweenSettings = {
  basketLevel: "nightmarish",
  treatPrice: 750000, weapon: "scary", revitalize: 12, scaryClothing: true, mortalCoil: false,
  darkPower: true, freebie: true, cashback: true,
  donor: true, company: "none", factionBonus: 50, maxCooldown: 48, startingCooldown: 0,
  canPrices: [250000, 500000, 800000, 1250000, 1750000, 3000000], fhcPrice: 14000000,
  startingEnergy: 1000, specialRefills: 0, drugPrice: 875000,
  drugInterval: 8, drugDelay: 0, jobPoints: 0, dailyJobPoints: 0,
  extraEnergy: 0, greenEggs: 0, attackCost: 0, otherCost: 0,
  startHour: 12, sleepHours: 0, sleepStart: 0, exchangeHours: 0,
};
export type HalloweenSource = { name: string; energy: number; count: number; cost: number };
export type HalloweenExchange = {
  minute: number; attacksBefore: number;
  treats: number; freebieTreats: number; cashbackTreats: number;
  energyBefore: number; energyReturned: number; energyWasted: number; afterEvent: boolean;
};
export type HalloweenRefill = {
  minute: number; source: string; energyBefore: number; energyAdded: number;
};
export type HalloweenResult = {
  progression?: { step: number; shadowTreats: number; treatsCollected: number; completed: boolean };
  id: string; book: HalloweenBook; booster: string; attacks: number; treatsPerAttack: number; earnedTreats: number;
  exchangedTreats: number; cashbackTreats: number; unexchangedTreats: number; rewardTreats: number;
  simulationRuns: number;
  /** 10th–90th percentiles of event net profit, not uncertainty in the mean. */
  profitRange: { low: number; high: number };
  /** Attack-only drop counts, averaged per event for estimates; includes zero-count outcomes. */
  treatDrops: { treats: number; attacks: number }[];
  /** Observed exchanged-treat lineage; sums to exchangedTreats, not Freebie rewards. */
  treatOrigins?: HalloweenTreatOrigins;
  /** One net-profit outcome per simulation, also used for the likely range. */
  profitSamples: number[];
  /** Individual exchange trace for single runs; averaged estimates have no single trace. */
  exchanges: HalloweenExchange[];
  /** Refill timing trace for single runs only. */
  refills: HalloweenRefill[];
  revenue: number; cost: number; profit: number; roi: number | null; breakEvenTreatPrice: number; effectiveTreatPrice: number;
  boosterCount: number; sources: HalloweenSource[]; wastedRegeneration: number; wastedDarkEnergy: number;
  wastedClaimEnergy: number; unusedEnergy: number; timeline: { hour: number; profit: number }[];
};

/** Attack-only treat drops per attack, pooled across all simulated events. */
export function getSimulatedTreatsPerAttack(result: Pick<HalloweenResult, "attacks" | "treatDrops">): number {
  return result.attacks > 0
    ? result.treatDrops.reduce((sum, drop) => sum + drop.treats * drop.attacks, 0) / result.attacks
    : 0;
}

export function validateHalloween(s: HalloweenSettings): string | null {
  if (!HALLOWEEN_BASKETS.some(basket => basket.id === s.basketLevel)) return "Select a valid basket level.";
  const ranges: [keyof HalloweenSettings, number, number][] = [
    ["treatPrice", 0, 1e9], ["revitalize", 10, 24], ["factionBonus", 0, 50],
    ["maxCooldown", 24, 48], ["startingCooldown", 0, 100], ["fhcPrice", 0, 1e9],
    ["startingEnergy", 0, 1000],
    ["specialRefills", 0, 100], ["drugPrice", 0, 1e9], ["drugInterval", 6, 24],
    ["drugDelay", 0, 168], ["jobPoints", 0, 10000], ["dailyJobPoints", 0, 100],
    ["extraEnergy", 0, 1000], ["greenEggs", 0, 100], ["attackCost", 0, 1e9],
    ["otherCost", 0, 1e12], ["startHour", 10, 16], ["sleepHours", 0, 16],
    ["sleepStart", 0, 23.99], ["exchangeHours", 0, 168],
  ];
  for (const [key, min, max] of ranges) {
    const value = s[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
      return `Enter ${label} between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
    }
  }
  if ([s.specialRefills, s.greenEggs, s.jobPoints, s.dailyJobPoints].some(v => !Number.isInteger(v))) return "Refill, egg and job-point counts must be whole numbers.";
  if (s.canPrices.length !== 6 || s.canPrices.some(p => !Number.isFinite(p) || p < 0 || p > 1e9)) return "Enter a valid price from $0 to $1bn for every can tier.";
  return null;
}

// Mulberry32; separate streams keep treat rolls independent of Revitalize procs.
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Always consume five rolls, including on a miss, to align attacks across strategies.
 * Multiplier upgrades stack independently; Cat in Hell is deliberately excluded.
 */
export function rollHalloweenTreats(chance: number, random: () => number, multipliers: readonly boolean[] = [true, true, true, true]): number {
  const drop = random() < chance;
  const multiplier = (random() < 0.2 && multipliers[0] ? 2 : 1) * (random() < 0.1 && multipliers[1] ? 3 : 1)
    * (random() < 0.05 && multipliers[2] ? 4 : 1) * (random() < 0.01 && multipliers[3] ? 5 : 1);
  return drop ? multiplier : 0;
}

/** One-minute schedule with whole attacks/exchanges and seeded treat/Revitalize rolls.
 * Source mechanics: wiki.torn.com/wiki/{Energy,Trick_or_Treat,Weapon_Bonus,Points_Market}.
 * The entered treat value includes Freebie. Disabling it removes the 10% item bonus
 * from that valuation as well as its bonus Dark Power energy.
 */
export type HalloweenProgressionPlan = { step: number; boosterLimit: number; compact?: boolean };
export function simulateHalloween(s: HalloweenSettings, book: HalloweenBook, booster: string, seed = SIMULATION_SEED, traceOrigins = false, plan?: HalloweenProgressionPlan): HalloweenResult {
  if (plan) {
    if (!Number.isInteger(plan.boosterLimit) || plan.boosterLimit < 0) throw new Error("Booster quantity must be a non-negative whole number.");
    if (book !== "none" || traceOrigins) throw new Error("Progression uses no book or return-origin tracing.");
    s = { ...s, weapon: "scary", scaryClothing: true, mortalCoil: false, darkPower: true, freebie: true, cashback: true };
  }
  const progress = plan ? new HalloweenUpgradeProgress(plan.step) : null;
  const boosterLimit = plan?.boosterLimit ?? Infinity;
  const compact = plan?.compact ?? false;
  const error = validateHalloween(s);
  if (error) throw new Error(error);
  const selectedBooster = HALLOWEEN_BOOSTERS.find(b => b.id === booster);
  if (!selectedBooster || !HALLOWEEN_BOOKS.some(b => b.id === book)) throw new Error("Unknown Halloween strategy.");
  const cap = book === "ugly" ? 250 : s.donor ? 150 : 100;
  const revitalize = s.weapon === "revitalize" ? s.revitalize / 100 : 0;
  // Each strategy uses the same attack-indexed rolls for a given run.
  // Prices and unrelated inputs never seed the generator, keeping comparisons repeatable.
  const rollRevitalize = createRandom(seed);
  const rollTreat = createRandom(seed ^ 0xa511e9b3);
  const rewardValueMultiplier = s.freebie ? 1 : 1 / 1.1;
  // Cat in Hell's rare jackpot is excluded from the expected treat yield.
  const selectedBasket = HALLOWEEN_BASKETS.find(item => item.id === s.basketLevel)!;
  const treatChance = (selectedBasket.treatChance + (s.scaryClothing ? 10 : 0) + (s.weapon === "scary" ? 10 : 0)) / 100;
  const treatsPerAttack = treatChance * 1.2 * 1.2 * 1.15 * 1.04;
  const canMultiplier = (1 + s.factionBonus / 100) * (s.company === "grocery7" ? 1.1 : 1) * (book === "fuel" ? 2 : 1);
  const canCooldown = 2 * (s.company === "restaurant10" ? 0.75 : s.company.startsWith("grocery") ? 0.9 : 1) * (book === "self" ? 0.5 : 1);
  const boosterCooldown = booster === "fhc" ? 6 : canCooldown;
  const boosterEnergy = booster === "fhc" ? cap : Math.round(selectedBooster.energy * canMultiplier);
  const boosterPrice = booster === "fhc" ? s.fhcPrice : s.canPrices[ENERGY_DRINK_TIERS.findIndex(t => t.energy === selectedBooster.energy)] ?? 0;
  const jpEnergy = HALLOWEEN_COMPANIES.find(c => c.id === s.company)?.energy ?? 0;
  const sources = new Map<string, HalloweenSource>();
  const origins = traceOrigins ? new HalloweenTreatOriginTracker() : null;
  const source = (name: string, energy: number, count = 0, cost = 0) => {
    const row = sources.get(name) ?? { name, energy: 0, count: 0, cost: 0 };
    row.energy += energy; row.count += count; row.cost += cost; sources.set(name, row);
    if (name !== "Dark Power returns" && name !== "Revitalize returns") origins?.addDirectEnergy(energy);
  };
  let energy = s.startingEnergy, basket = 0, attacks = 0, earnedTreats = 0, exchangedTreats = 0;
  let cashbackTreats = 0, rewardTreats = 0, cost = s.otherCost;
  let wastedRegeneration = 0, wastedDarkEnergy = 0, wastedClaimEnergy = 0, boosterCount = 0;
  let cooldown = s.startingCooldown, nextDrug = s.drugDelay * 60;
  let eggs = s.greenEggs, points = s.jobPoints, usedPoints = 0, refillDay = -1, currentDay = -1;
  let specialRefills = s.specialRefills, currentMinute = 0;
  let started = false;
  const exchanges: HalloweenExchange[] = [];
  const refills: HalloweenRefill[] = [];
  const dropCounts = Array<number>(121).fill(0);
  const timeline: HalloweenResult["timeline"] = [{ hour: 0, profit: -cost }];
  const awake = (minute: number) => ((s.startHour * 60 + minute - s.sleepStart * 60 + 1440) % 1440) >= s.sleepHours * 60;
  let lastActiveMinute = 10079;
  while (!awake(lastActiveMinute)) lastActiveMinute--;
  const useRefill = (forceDaily = false, forceFhc = false, forceSpecial = false) => {
    if (energy >= 25) return false;
    const empty = energy === 0;
    let name: string, spend = 0;
    // Special refills must be exhausted before the daily refill can be used,
    // including when the midnight deadline forces a top-up over carried energy.
    if (specialRefills > 0 && (empty || forceSpecial || forceDaily)) {
      name = "Special refills"; specialRefills--;
    } else if (specialRefills === 0 && refillDay !== currentDay && (empty || forceDaily)) {
      name = "Daily point refills"; refillDay = currentDay;
    } else if (booster === "fhc" && boosterCount < boosterLimit && eggs === 0 && cooldown < s.maxCooldown - 1e-8 && (empty || forceFhc)) {
      name = selectedBooster.name; spend = boosterPrice; boosterCount++; cooldown += boosterCooldown;
    } else return false;
    // Refill the bar only after using every affordable attack. Normally this is at 0E;
    // deadline fallbacks top up the remainder without counting that energy twice.
    const added = Math.max(0, cap - energy);
    if (!compact) refills.push({ minute: currentMinute, source: name, energyBefore: energy, energyAdded: added });
    source(name, added, 1, spend); cost += spend; energy += added;
    return true;
  };
  const exchangeEnergy = (quantity: number) => s.darkPower && (!progress || progress.complete)
    ? 5 * (quantity + (s.freebie ? Math.floor(quantity / 10) : 0)) : 0;
  const exchange = (afterEvent = false) => {
    if (progress && !progress.complete) return false;
    // Torn exchanges the entire basket. Never select a partial batch or exchange fractions.
    const quantity = basket;
    if (quantity === 0) return false;
    const finalMinute = currentMinute === EVENT_MINUTES - 1;
    const cleanup = currentMinute >= CLEANUP_START;
    if (!afterEvent) {
      if (!cleanup) {
        // Prefer 100/110/120 during the main event.
        if (quantity < 100 || (quantity < 120 && quantity % 10 !== 0)) return false;
      } else {
        // In the final hour, take smaller multiples of ten. Spend available attacks
        // to reach a multiple when possible; exchange a non-multiple if attacks stall.
        // Save baskets below ten until the final minute, then cash out every last treat.
        if (quantity < 10 && !finalMinute) return false;
        if (quantity % 10 !== 0 && quantity < 120 && energy >= 25) return false;
      }
    }
    const freebieTreats = s.freebie ? Math.floor(quantity / 10) : 0;
    // Cashback is calculated before Freebie (Torn patch #218, 16 November 2021).
    const cashback = s.cashback ? Math.floor(quantity / 10) : 0;
    const darkEnergy = exchangeEnergy(quantity);
    // A rare stacked drop can exceed the cap even from empty. Spend every affordable
    // attack first, then exchange the whole basket and record unavoidable lost energy.
    if (!afterEvent && energy + darkEnergy > 1000 && !(darkEnergy > 1000 && energy < 25)) return false;
    const acceptedEnergy = Math.min(darkEnergy, Math.max(0, 1000 - energy));
    const energyWasted = darkEnergy - acceptedEnergy;
    origins?.recordExchange(quantity, cashback, acceptedEnergy, freebieTreats);
    if (!compact) exchanges.push({ minute: afterEvent ? EVENT_MINUTES : currentMinute, attacksBefore: attacks,
      treats: quantity, freebieTreats, cashbackTreats: cashback,
      energyBefore: energy, energyReturned: acceptedEnergy, energyWasted, afterEvent });
    basket = cashback;
    cashbackTreats += cashback; exchangedTreats += quantity;
    if (progress) progress.collected += cashback;
    rewardTreats += quantity + freebieTreats;
    energy += acceptedEnergy; wastedDarkEnergy += energyWasted;
    source("Dark Power returns", acceptedEnergy);
    return true;
  };
  const attack = () => {
    while (true) {
      // Prefer refills at zero only when the refill and pending exchange both fit.
      // Otherwise exchange first: more refill-funded attacks would grow the basket
      // and turn an oversized drop into avoidable Dark Power waste.
      if (energy === 0 && cap + exchangeEnergy(basket) <= 1000 && useRefill()) continue;
      const exchanged = exchange();
      if (energy < 25) {
        // A small exchange can leave Cashback that funds another exchange, even when
        // Dark Power is disabled. Every successful exchange consumes a non-empty basket.
        if (exchanged) continue;
        break;
      }
      // Pay the full attack cost before rolling for a 25E Revitalize return.
      energy -= 25;
      attacks++;
      const chance = progress ? (HALLOWEEN_BASKETS[progress.basketIndex].treatChance
        + (progress.has("clothing") ? 10 : 0) + (progress.has("weapon") ? 10 : 0)) / 100 : treatChance;
      const droppedTreats = rollHalloweenTreats(chance, rollTreat, progress
        ? [progress.has("double"), progress.has("triple"), progress.has("quadruple"), progress.has("quintuple")] : undefined);
      dropCounts[droppedTreats]++;
      earnedTreats += droppedTreats;
      basket += droppedTreats;
      if (progress) { progress.collectAttack(droppedTreats); basket = progress.purchase(basket); }
      const returned = revitalize > 0 && rollRevitalize() < revitalize ? 25 : 0;
      origins?.recordAttack(droppedTreats, returned);
      energy += returned;
      source("Revitalize returns", returned, returned ? 1 : 0);
      source("Attack supplies", 0, 1, s.attackCost); cost += s.attackCost;
      // Check refills/exchanges only after completed attacks.
    }
  };
  const claim = (name: string, amount: number, count = 0, spend = 0) => {
    const accepted = Math.min(amount, Math.max(0, 1000 - energy));
    wastedClaimEnergy += amount - accepted;
    source(name, accepted, count, spend); cost += spend;
    energy += accepted; attack();
  };
  source("Other costs", 0, 0, cost);
  source("Starting energy", s.startingEnergy);
  for (let minute = 0; minute < 10080; minute++) {
    currentMinute = minute;
    if (minute > 0) cooldown = Math.max(0, cooldown - 1 / 60);
    const absoluteMinute = Math.round(s.startHour * 60) + minute;
    const day = Math.floor(absoluteMinute / 1440);
    if (day !== currentDay) { currentDay = day; usedPoints = 0; }
    // Job points are awarded at 18:00 TCT; all other daily limits reset at midnight.
    if (absoluteMinute % 1440 === 1080) points += s.dailyJobPoints;
    const active = awake(minute);
    if ((minute + 1) % (s.donor ? 10 : 15) === 0) {
      const regen = book === "higher" ? 6 : 5;
      const accepted = Math.min(regen, Math.max(0, cap - energy));
      energy += accepted; wastedRegeneration += regen - accepted;
      source("Natural regeneration", accepted);
    }
    if (s.mortalCoil && minute % 60 === 0) {
      origins?.addMortalCoilTreat();
      basket += 1;
      earnedTreats += 1;
    }
    if (active) {
      attack();
      if (!started) {
        started = true;
        claim("Other one-off energy", s.extraEnergy);
      }
      if (jpEnergy && points > 0 && usedPoints < 100) {
        const redeem = Math.min(points, 100 - usedPoints);
        claim("Company job points", redeem * jpEnergy, redeem); points -= redeem; usedPoints += redeem;
      }
      if (minute >= nextDrug) {
        claim("Xanax", 250, 1, s.drugPrice);
        nextDrug = minute + s.drugInterval * 60;
      }
      // Booster cooldown is shared. Owned eggs are consumed before the paid booster.
      while (eggs > 0 && cooldown < s.maxCooldown - 1e-8) {
        claim("Green Easter eggs", 500, 1); eggs--; cooldown += 6;
      }
      while (booster !== "none" && booster !== "fhc" && boosterCount < boosterLimit && eggs === 0 && cooldown < s.maxCooldown - 1e-8) {
        claim(selectedBooster.name, boosterEnergy, 1, boosterPrice);
        boosterCount++; cooldown += boosterCooldown;
      }
      // Attacks drain energy every active minute in preparation for the next FHC.
      // Use every available cooldown slot immediately, even with a sub-25E remainder.
      // Special refills can wait for zero, but must be used before the last visit ends.
      while (useRefill(false, true, minute === lastActiveMinute)) attack();
    }
    // Daily refills are guaranteed by the comparison assumptions, including a
    // brief refill/attack visit if a partial event day is entirely inactive.
    const dayEnds = Math.floor((absoluteMinute + 1) / 1440) !== day || minute === 10079;
    if (refillDay !== day && dayEnds) {
      attack();
      if (!started) {
        started = true;
        claim("Other one-off energy", s.extraEnergy);
      }
      while (refillDay !== day && useRefill(true)) attack();
    }
    if (!compact && (minute + 1) % 60 === 0) timeline.push({ hour: (minute + 1) / 60, profit: rewardTreats * s.treatPrice / 1.1 - cost });
  }
  // Cash out any remaining whole basket and its shrinking Cashback remainder.
  // No attacks occur here: energy returned after the cutoff has no Halloween attack value.
  while (exchange(true)) { /* Cashback is always smaller than the basket exchanged. */ }
  // Price input includes the full 10% Freebie bonus. Value actual whole bonus rewards,
  // including batches that overshoot 120, rather than crediting a fractional bonus.
  const revenue = rewardTreats * s.treatPrice / 1.1;
  const effectiveTreatPrice = exchangedTreats ? revenue / exchangedTreats : s.treatPrice * rewardValueMultiplier;
  timeline[timeline.length - 1].profit = revenue - cost;
  return { id: `${book}:${booster}`, book, booster, attacks, treatsPerAttack, earnedTreats, exchangedTreats, cashbackTreats,
    ...(progress ? { progression: { step: progress.step, shadowTreats: progress.shadowTreats,
      treatsCollected: earnedTreats + progress.shadowTreats + cashbackTreats, completed: progress.complete } } : {}),
    unexchangedTreats: basket, rewardTreats, exchanges, refills, simulationRuns: 1,
    profitRange: { low: revenue - cost, high: revenue - cost },
    treatDrops: HALLOWEEN_TREAT_OUTCOMES.map(treats => ({ treats, attacks: dropCounts[treats] })),
    ...(origins ? { treatOrigins: origins.result() } : {}),
    profitSamples: [revenue - cost],
    revenue, cost, profit: revenue - cost, roi: cost ? (revenue - cost) / cost : null,
    effectiveTreatPrice,
    // Express break-even in the same with-Freebie units as the price input.
    breakEvenTreatPrice: rewardTreats ? cost * 1.1 / rewardTreats : 0,
    boosterCount, sources: [...sources.values()].filter(r => r.energy || r.cost || r.count),
    wastedRegeneration, wastedDarkEnergy, wastedClaimEnergy, unusedEnergy: energy, timeline };
}

/** Interpolated empirical percentiles: the central 80% of simulated event outcomes. */
export function getHalloweenProfitRange(profits: readonly number[]): HalloweenResult["profitRange"] {
  if (!profits.length) throw new Error("At least one profit outcome is required.");
  const sorted = [...profits].sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  return { low: percentile(0.1), high: percentile(0.9) };
}

/** Average whole-treat/Revitalize simulations; reward valuation stays at the flat input price. */
export function estimateHalloween(s: HalloweenSettings, book: HalloweenBook, booster: string, runs = HALLOWEEN_SIMULATION_RUNS, traceOrigins = false): HalloweenResult {
  if (!Number.isInteger(runs) || runs < 1 || runs > HALLOWEEN_REFINED_RUNS) throw new Error("Simulation count must be a whole number from 1 to 1024.");
  const first = simulateHalloween(s, book, booster, SIMULATION_SEED, traceOrigins);
  const profits = [first.profit];
  const total = { ...first, exchanges: [], refills: [], sources: [],
    ...(first.treatOrigins ? { treatOrigins: { ...first.treatOrigins, energyRounds: [...first.treatOrigins.energyRounds] } } : {}),
    treatDrops: first.treatDrops.map(drop => ({ ...drop })),
    timeline: first.timeline.map(point => ({ ...point })) } as HalloweenResult;
  const totals = new Map(first.sources.map(row => [row.name, { ...row }]));
  const averagedFields = ["attacks", "earnedTreats", "exchangedTreats", "cashbackTreats", "unexchangedTreats",
    "rewardTreats", "revenue", "cost", "profit", "boosterCount", "wastedRegeneration", "wastedDarkEnergy", "wastedClaimEnergy", "unusedEnergy"] as const;
  for (let run = 1; run < runs; run++) {
    const row = simulateHalloween(s, book, booster, (SIMULATION_SEED + Math.imul(run, 0x9e3779b9)) >>> 0, traceOrigins);
    profits.push(row.profit);
    row.treatDrops.forEach((drop, index) => { total.treatDrops[index].attacks += drop.attacks; });
    if (total.treatOrigins && row.treatOrigins) {
      const origins = total.treatOrigins;
      row.treatOrigins.energyRounds.forEach((amount, index) => { origins.energyRounds[index] += amount; });
      origins.mortalCoil += row.treatOrigins.mortalCoil;
      origins.energyFreebieRewards += row.treatOrigins.energyFreebieRewards;
    }
    for (const field of averagedFields) total[field] += row[field];
    row.sources.forEach(item => {
      const sum = totals.get(item.name) ?? { name: item.name, energy: 0, count: 0, cost: 0 };
      sum.energy += item.energy; sum.count += item.count; sum.cost += item.cost;
      totals.set(item.name, sum);
    });
    row.timeline.forEach((point, index) => { total.timeline[index].profit += point.profit; });
  }
  for (const field of averagedFields) total[field] /= runs;
  total.treatDrops.forEach(drop => { drop.attacks /= runs; });
  if (total.treatOrigins) {
    total.treatOrigins.energyRounds = total.treatOrigins.energyRounds.map(amount => amount / runs);
    total.treatOrigins.mortalCoil /= runs;
    total.treatOrigins.energyFreebieRewards /= runs;
  }
  total.sources = [...totals.values()].map(row => ({ ...row,
    energy: row.energy / runs, count: row.count / runs, cost: row.cost / runs }));
  total.timeline.forEach(point => { point.profit /= runs; });
  total.profit = total.revenue - total.cost;
  total.timeline[total.timeline.length - 1].profit = total.profit;
  total.roi = total.cost ? total.profit / total.cost : null;
  total.effectiveTreatPrice = total.exchangedTreats ? total.revenue / total.exchangedTreats : first.effectiveTreatPrice;
  total.breakEvenTreatPrice = total.rewardTreats ? total.cost * 1.1 / total.rewardTreats : 0;
  total.simulationRuns = runs;
  total.profitRange = getHalloweenProfitRange(profits);
  total.profitSamples = profits;
  return total;
}

export function compareHalloween(s: HalloweenSettings, runs = HALLOWEEN_SIMULATION_RUNS,
  onProgress?: (completed: number, total: number) => void): HalloweenResult[] {
  let completed = 0;
  const total = HALLOWEEN_BOOKS.length * HALLOWEEN_BOOSTERS.length;
  return HALLOWEEN_BOOKS.flatMap(book => HALLOWEEN_BOOSTERS.map(booster => {
    const result = estimateHalloween(s, book.id, booster.id, runs);
    onProgress?.(++completed, total);
    return result;
  }));
}
