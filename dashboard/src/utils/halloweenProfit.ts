import { ENERGY_DRINK_TIERS } from "./energyDrinkStrategy";

export const HALLOWEEN_HOURS = 168;
export const HALLOWEEN_BASKETS = [
  { id: "horrifying", name: "Horrifying", treatChance: 70 },
  { id: "petrifying", name: "Petrifying", treatChance: 75 },
  { id: "nightmarish", name: "Nightmarish", treatChance: 80 },
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
  treatPrice: number; weapon: "scary" | "revitalize"; revitalize: number; scaryClothing: boolean;
  donor: boolean; company: HalloweenCompany; factionBonus: number;
  maxCooldown: number; startingCooldown: number; canPrices: number[]; fhcPrice: number;
  startingEnergy: number; specialRefills: number;
  drugPrice: number; drugInterval: number; drugDelay: number;
  jobPoints: number; dailyJobPoints: number; extraEnergy: number; greenEggs: number;
  attackCost: number; otherCost: number; startHour: number; sleepHours: number; sleepStart: number;
  exchangeHours: number;
};
export const DEFAULT_HALLOWEEN: HalloweenSettings = {
  basketLevel: "nightmarish",
  treatPrice: 750000, weapon: "scary", revitalize: 12, scaryClothing: true,
  donor: true, company: "none", factionBonus: 50, maxCooldown: 48, startingCooldown: 0,
  canPrices: [250000, 500000, 800000, 1250000, 1750000, 3000000], fhcPrice: 14000000,
  startingEnergy: 1000, specialRefills: 0, drugPrice: 875000,
  drugInterval: 8, drugDelay: 0, jobPoints: 0, dailyJobPoints: 0,
  extraEnergy: 0, greenEggs: 0, attackCost: 0, otherCost: 0,
  startHour: 12, sleepHours: 0, sleepStart: 0, exchangeHours: 0,
};
export type HalloweenSource = { name: string; energy: number; count: number; cost: number };
export type HalloweenResult = {
  id: string; book: HalloweenBook; booster: string; attacks: number; treatsPerAttack: number; earnedTreats: number;
  exchangedTreats: number; cashbackTreats: number; inflationTreats: number;
  revenue: number; cost: number; profit: number; roi: number | null; breakEvenTreatPrice: number;
  boosterCount: number; sources: HalloweenSource[]; wastedRegeneration: number; wastedDarkEnergy: number;
  unusedEnergy: number; timeline: { hour: number; profit: number }[];
};

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

/** Expected-value model: one-minute activity schedule, immediate attacks/exchanges while active.
 * Source mechanics: wiki.torn.com/wiki/{Energy,Trick_or_Treat,Weapon_Bonus,Points_Market}.
 * Money per exchanged treat includes item bonuses; Freebie is applied separately ONLY to energy.
 */
export function simulateHalloween(s: HalloweenSettings, book: HalloweenBook, booster: string): HalloweenResult {
  const error = validateHalloween(s);
  if (error) throw new Error(error);
  const selectedBooster = HALLOWEEN_BOOSTERS.find(b => b.id === booster);
  if (!selectedBooster || !HALLOWEEN_BOOKS.some(b => b.id === book)) throw new Error("Unknown Halloween strategy.");
  const cap = book === "ugly" ? 250 : s.donor ? 150 : 100;
  const revitalize = s.weapon === "revitalize" ? s.revitalize / 100 : 0;
  // Cat in Hell's rare jackpot is excluded from the expected treat yield.
  const selectedBasket = HALLOWEEN_BASKETS.find(item => item.id === s.basketLevel)!;
  const treatsPerAttack = (selectedBasket.treatChance + (s.scaryClothing ? 10 : 0) + (s.weapon === "scary" ? 10 : 0)) / 100 * 1.2 * 1.2 * 1.15 * 1.04;
  const canMultiplier = (1 + s.factionBonus / 100) * (s.company === "grocery7" ? 1.1 : 1) * (book === "fuel" ? 2 : 1);
  const canCooldown = 2 * (s.company === "restaurant10" ? 0.75 : s.company.startsWith("grocery") ? 0.9 : 1) * (book === "self" ? 0.5 : 1);
  const boosterCooldown = booster === "fhc" ? 6 : canCooldown;
  const boosterEnergy = booster === "fhc" ? cap : Math.round(selectedBooster.energy * canMultiplier);
  const boosterPrice = booster === "fhc" ? s.fhcPrice : s.canPrices[ENERGY_DRINK_TIERS.findIndex(t => t.energy === selectedBooster.energy)] ?? 0;
  const jpEnergy = HALLOWEEN_COMPANIES.find(c => c.id === s.company)?.energy ?? 0;
  const sources = new Map<string, HalloweenSource>();
  const source = (name: string, energy: number, count = 0, cost = 0) => {
    const row = sources.get(name) ?? { name, energy: 0, count: 0, cost: 0 };
    row.energy += energy; row.count += count; row.cost += cost; sources.set(name, row);
  };
  let energy = s.startingEnergy, basket = 0, attacks = 0, earnedTreats = 0, exchangedTreats = 0;
  let cashbackTreats = 0, inflationTreats = 0, cost = s.otherCost;
  let wastedRegeneration = 0, wastedDarkEnergy = 0, boosterCount = 0;
  let cooldown = s.startingCooldown, nextDrug = s.drugDelay * 60, nextExchange = 0;
  let eggs = s.greenEggs, points = s.jobPoints, usedPoints = 0, refillDay = -1, currentDay = -1;
  let started = false, exchanging = false;
  const timeline: HalloweenResult["timeline"] = [{ hour: 0, profit: -cost }];
  const awake = (minute: number) => ((s.startHour * 60 + minute - s.sleepStart * 60 + 1440) % 1440) >= s.sleepHours * 60;
  let lastActiveMinute = 10079;
  while (!awake(lastActiveMinute)) lastActiveMinute--;
  const attack = (amount: number) => {
    const hits = amount / (25 * (1 - revitalize));
    attacks += hits;
    const treats = hits * treatsPerAttack;
    earnedTreats += treats; basket += treats;
    const returned = hits * revitalize * 25;
    source("Revitalize returns", returned);
    const attackSpend = hits * s.attackCost;
    source("Attack supplies", 0, hits, attackSpend); cost += attackSpend;
  };
  const claim = (name: string, amount: number, count = 0, spend = 0) => {
    source(name, amount, count, spend); cost += spend; attack(amount);
    if (!exchanging && s.exchangeHours === 0) exchange();
  };
  const exchange = () => {
    exchanging = true;
    // Cashback + Dark Power form a convergent loop, including Revitalize on recycled attacks.
    for (let i = 0; i < 200 && basket > 1e-9; i++) {
      const quantity = basket; basket = quantity * 0.1;
      cashbackTreats += basket; exchangedTreats += quantity;
      const darkEnergy = quantity * 5 * 1.1;
      const usable = Math.min(1000, darkEnergy);
      wastedDarkEnergy += darkEnergy - usable;
      claim("Dark Power returns", usable);
    }
    exchanging = false;
  };
  source("Other costs", 0, 0, cost);
  source("Starting energy", s.startingEnergy);
  for (let minute = 0; minute < 10080; minute++) {
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
    if (minute % 60 === 0) {
      const inflation = basket * 0.001;
      inflationTreats += inflation; basket += inflation + 1;
      earnedTreats += 1;
    }
    if (active) {
      attack(energy); energy = 0;
      if (s.exchangeHours === 0) exchange();
      if (!started) {
        started = true;
        claim("Other one-off energy", s.extraEnergy);
        for (let refill = 0; refill < s.specialRefills; refill++) claim("Special refills", cap, 1);
      }
      if (refillDay !== day) {
        claim("Daily point refills", cap, 1); refillDay = day;
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
      while (booster !== "none" && eggs === 0 && cooldown < s.maxCooldown - 1e-8) {
        claim(selectedBooster.name, boosterEnergy, 1, boosterPrice); boosterCount++; cooldown += boosterCooldown;
      }
      if (minute >= nextExchange || minute === lastActiveMinute) {
        exchange(); nextExchange = minute + s.exchangeHours * 60;
      }
    }
    // Daily refills are guaranteed by the comparison assumptions, including a
    // brief refill/attack visit if a partial event day is entirely inactive.
    const dayEnds = Math.floor((absoluteMinute + 1) / 1440) !== day || minute === 10079;
    if (refillDay !== day && dayEnds) {
      attack(energy); energy = 0;
      if (!started) {
        started = true;
        claim("Other one-off energy", s.extraEnergy);
        for (let refill = 0; refill < s.specialRefills; refill++) claim("Special refills", cap, 1);
      }
      claim("Daily point refills", cap, 1); refillDay = day;
      exchange();
    }
    if ((minute + 1) % 60 === 0) timeline.push({ hour: (minute + 1) / 60, profit: exchangedTreats * s.treatPrice - cost });
  }
  // Sell treats accrued during a final inactive period after the event. Returned energy
  // can no longer earn Halloween treats, so it is recorded as unused, never recycled.
  if (basket > 1e-9) {
    const exchanged = basket / 0.9;
    exchangedTreats += exchanged; cashbackTreats += exchanged * 0.1;
    const dark = exchanged * 5.5;
    const accepted = Math.min(Math.max(0, 1000 - energy), dark);
    energy += accepted; wastedDarkEnergy += dark - accepted;
    source("Dark Power returns", accepted);
  }
  const revenue = exchangedTreats * s.treatPrice;
  timeline[timeline.length - 1].profit = revenue - cost;
  return { id: `${book}:${booster}`, book, booster, attacks, treatsPerAttack, earnedTreats, exchangedTreats, cashbackTreats,
    inflationTreats, revenue, cost, profit: revenue - cost, roi: cost ? (revenue - cost) / cost : null,
    breakEvenTreatPrice: exchangedTreats ? cost / exchangedTreats : 0,
    boosterCount, sources: [...sources.values()].filter(r => r.energy || r.cost || r.count),
    wastedRegeneration, wastedDarkEnergy, unusedEnergy: energy, timeline };
}

export function compareHalloween(s: HalloweenSettings): HalloweenResult[] {
  return HALLOWEEN_BOOKS.flatMap(book => HALLOWEEN_BOOSTERS.map(booster => simulateHalloween(s, book.id, booster.id)));
}
