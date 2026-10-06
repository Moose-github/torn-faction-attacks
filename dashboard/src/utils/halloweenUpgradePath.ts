/** Purchase order supplied by the user. Costs and unlock thresholds: Torn Halloween wiki. */
export const HALLOWEEN_UPGRADE_PATH = [
  { id: "clothing", name: "I See Dead People", cost: 3, unlock: 0 },
  { id: "weapon", name: "Here’s Johnny", cost: 5, unlock: 0 },
  { id: "double", name: "Doubler", cost: 25, unlock: 0 },
  { id: "triple", name: "Tripler", cost: 50, unlock: 0 },
  { id: "quadruple", name: "Quadrupler", cost: 75, unlock: 0 },
  { id: "cat", name: "Cat in Hell", cost: 13, unlock: 190 },
  { id: "quintuple", name: "Quintupler", cost: 100, unlock: 0 },
  { id: "shadow", name: "Shadow of Doubt", cost: 1000, unlock: 940 },
  { id: "multipack", name: "Multipack", cost: 180, unlock: 940 },
  { id: "devil", name: "Deal with the Devil", cost: 320, unlock: 940 },
  { id: "darkPower", name: "Dark Power", cost: 285, unlock: 190 },
  { id: "freebie", name: "Freebie", cost: 120, unlock: 190 },
  { id: "bloodyMary", name: "Bloody Mary", cost: 15, unlock: 40 },
  { id: "chianti", name: "Nice Chianti", cost: 30, unlock: 40 },
  { id: "nightcrawler", name: "Nightcrawler", cost: 45, unlock: 40 },
  { id: "alive", name: "It’s Alive", cost: 90, unlock: 40 },
  { id: "cashback", name: "Cashback", cost: 230, unlock: 190 },
  { id: "candyman", name: "Candyman", cost: 5, unlock: 40 },
  { id: "sweetRelease", name: "Sweet Release", cost: 10, unlock: 40 },
  { id: "coldSweat", name: "Cold Sweat", cost: 170, unlock: 190 },
] as const;
export const HALLOWEEN_BASKET_THRESHOLDS = [0, 5, 15, 40, 90, 190, 440, 940, 1940, 4440];
const upgradeSteps = Object.fromEntries(HALLOWEEN_UPGRADE_PATH.map((row, i) => [row.id, i + 1]));
export const HALLOWEEN_PROGRESSION_STARTS = [
  { step: 0, label: "No upgrades yet", collected: 0 },
  { step: 1, label: "1 · I See Dead People", collected: 3 },
  { step: 2, label: "2 · Here’s Johnny", collected: 8 },
  { step: 3, label: "3 · Doubler", collected: 33 },
  { step: 4, label: "4 · Tripler", collected: 83 },
  { step: 5, label: "5 · Quadrupler", collected: 158 },
  { step: 6, label: "6 · Cat in Hell", collected: 190 },
  { step: 7, label: "7 · Quintupler", collected: 271 },
  { step: 16, label: "8–16 · Shadow of Doubt + eight upgrades", collected: 2371 },
  { step: 17, label: "17 · Cashback", collected: 2586 },
  { step: 18, label: "18 · Candyman", collected: 2591 },
  { step: 19, label: "19 · Sweet Release", collected: 2601 },
  { step: 20, label: "20 · Cold Sweat", collected: 2771 },
] as const;
export const progressionBasketIndex = (collected: number) =>
  HALLOWEEN_BASKET_THRESHOLDS.reduce((index, threshold, i) => collected >= threshold ? i : index, 0);

export class HalloweenUpgradeProgress {
  step: number;
  collected: number;
  basketIndex: number;
  shadowTreats = 0;
  constructor(step: number) {
    const start = HALLOWEEN_PROGRESSION_STARTS.find(row => row.step === step);
    if (!start) throw new Error("Select a valid starting upgrade milestone.");
    this.step = step; this.collected = start.collected;
    this.basketIndex = progressionBasketIndex(this.collected);
  }
  has(id: typeof HALLOWEEN_UPGRADE_PATH[number]["id"]) {
    return this.step >= upgradeSteps[id];
  }
  get complete() { return this.step === HALLOWEEN_UPGRADE_PATH.length; }
  collectAttack(treats: number) {
    this.collected += treats;
    if (treats > 0) this.basketIndex = progressionBasketIndex(this.collected);
  }
  purchase(balance: number) {
    while (!this.complete) {
      const next = HALLOWEEN_UPGRADE_PATH[this.step];
      // A Shadow bonus counts immediately, but an attack drop triggers basket evolution.
      if (balance < next.cost || HALLOWEEN_BASKET_THRESHOLDS[this.basketIndex] < next.unlock) break;
      balance -= next.cost;
      this.step++;
      if (next.id === "shadow") {
        balance += 1100; this.collected += 1100; this.shadowTreats += 1100;
      }
    }
    return balance;
  }
}
