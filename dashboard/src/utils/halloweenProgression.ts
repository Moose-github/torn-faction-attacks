import { HALLOWEEN_BOOSTERS, HALLOWEEN_BASKETS, simulateHalloween, validateHalloween,
  type HalloweenSettings } from "./halloweenProfit";
import { HALLOWEEN_PROGRESSION_STARTS, progressionBasketIndex } from "./halloweenUpgradePath";

export type ProgressionCandidate = {
  booster: string; quantity: number; used: number; boosterSpend: number; collected: number;
  profit: number; revenue: number; cost: number; completion: number; attacks: number;
};
export type ProgressionRecommendation = {
  step: number; label: string; basket: string; baseline: ProgressionCandidate;
  profit: ProgressionCandidate; progression: ProgressionCandidate; candidates: number;
};
export type ProgressionReport = { rows: ProgressionRecommendation[]; runs: number; allowance: number; calculatedAt: number };
export type ProgressionUpdate = { completed: number; total: number; label: string };

/** Ignore fixed-basket, book and weapon selections; retain the shared energy and price inputs. */
export function progressionSettings(settings: HalloweenSettings): HalloweenSettings {
  return { ...settings, basketLevel: "spooky", weapon: "scary", revitalize: 12, scaryClothing: true,
    mortalCoil: false, darkPower: true, freebie: true, cashback: true };
}
export function progressionBoosterLimit(s: HalloweenSettings, booster: string) {
  if (booster === "none") return 0;
  const cooldown = booster === "fhc" ? 6 : 2 * (s.company === "restaurant10" ? .75 : s.company.startsWith("grocery") ? .9 : 1);
  return Math.max(0, Math.ceil((168 + s.maxCooldown - s.startingCooldown - s.greenEggs * 6 - 1e-8) / cooldown));
}
export function estimateProgression(settings: HalloweenSettings, step: number, booster: string, quantity: number, runs: number): ProgressionCandidate {
  if (!Number.isInteger(runs) || runs < 1 || runs > 1024) throw new Error("Simulation count must be a whole number from 1 to 1024.");
  const value: ProgressionCandidate = { booster, quantity, used: 0, boosterSpend: 0, collected: 0, profit: 0,
    revenue: 0, cost: 0, completion: 0, attacks: 0 };
  for (let i = 0; i < runs; i++) {
    const row = simulateHalloween(settings, "none", booster, (0x6d2b79f5 + Math.imul(i, 0x9e3779b9)) >>> 0, false,
      { step, boosterLimit: quantity, compact: true });
    value.used += row.boosterCount;
    value.boosterSpend += row.sources.find(source => source.name === HALLOWEEN_BOOSTERS.find(b => b.id === booster)!.name)?.cost ?? 0;
    value.collected += row.progression!.treatsCollected; value.profit += row.profit; value.revenue += row.revenue;
    value.cost += row.cost; value.attacks += row.attacks; value.completion += Number(row.progression!.completed);
  }
  for (const key of ["used", "boosterSpend", "collected", "profit", "revenue", "cost", "completion", "attacks"] as const) value[key] /= runs;
  return value;
}
const byProfit = (a: ProgressionCandidate, b: ProgressionCandidate) => b.profit - a.profit || b.collected - a.collected || a.boosterSpend - b.boosterSpend || a.quantity - b.quantity;
const byProgression = (a: ProgressionCandidate, b: ProgressionCandidate) => b.collected - a.collected || byProfit(a, b);
export function chooseProgression(candidates: ProgressionCandidate[], baseline: ProgressionCandidate, allowance: number) {
  const pool = [baseline, ...candidates];
  return { profit: [...pool].sort(byProfit)[0],
    progression: pool.filter(row => row.profit >= baseline.profit - allowance - 1e-6).sort(byProgression)[0] };
}

/** Bounded search: broad quantity grid, nearby whole quantities, then 128/1024-run finalists.
 * Profit is not assumed monotonic: completing upgrades can change the return abruptly.
 * The UI calls these the best strategies found, not a proof of a global optimum.
 */
export function calculateProgressionRecommendations(input: HalloweenSettings, allowance: number, runs: number,
  onProgress?: (update: ProgressionUpdate) => void, previous?: ProgressionReport): ProgressionReport {
  const settings = progressionSettings(input);
  const error = validateHalloween(settings);
  if (error) throw new Error(error);
  if (!Number.isFinite(allowance) || allowance < 0 || allowance > 1e12) throw new Error("Enter an allowance between $0 and $1tn.");
  if (runs !== 128 && runs !== 1024) throw new Error("Use 128 or 1,024 simulations.");
  const rows: ProgressionRecommendation[] = [];
  const total = HALLOWEEN_PROGRESSION_STARTS.length;
  for (const start of HALLOWEEN_PROGRESSION_STARTS) {
    onProgress?.({ completed: rows.length, total, label: `${start.label}: comparing booster quantities` });
    const finalists = new Map<string, { booster: string; quantity: number }>();
    const add = (row: Pick<ProgressionCandidate, "booster" | "quantity">) => finalists.set(`${row.booster}:${row.quantity}`, row);
    const coarseBaseline = estimateProgression(settings, start.step, "none", 0, 8);
    add(coarseBaseline);
    const old = previous?.rows.find(row => row.step === start.step);
    if (old) { add(old.profit); add(old.progression); }
    for (const booster of HALLOWEEN_BOOSTERS.filter(row => row.id !== "none")) {
      const maximum = progressionBoosterLimit(settings, booster.id);
      if (!maximum) continue;
      const stride = Math.max(1, Math.ceil(maximum / 8));
      const sampled = new Map<number, ProgressionCandidate>();
      const sample = (quantity: number) => {
        if (quantity < 1 || quantity > maximum || sampled.has(quantity)) return;
        sampled.set(quantity, estimateProgression(settings, start.step, booster.id, quantity, 8));
      };
      sample(1); sample(maximum);
      for (let quantity = stride; quantity < maximum; quantity += stride) sample(quantity);
      const grid = [...sampled.values()];
      const best = chooseProgression(grid, coarseBaseline, allowance);
      const boundary = [...grid].sort((a, b) => Math.abs(a.profit - coarseBaseline.profit + allowance)
        - Math.abs(b.profit - coarseBaseline.profit + allowance))[0];
      // Inspect every whole quantity around leaders and the closest observed budget boundary.
      for (const center of [best.profit, best.progression, boundary]) {
        if (center.booster === "none") continue;
        for (let quantity = center.quantity - stride; quantity <= center.quantity + stride; quantity++) sample(quantity);
      }
      const candidates = [...sampled.values()];
      const leaders = chooseProgression(candidates, coarseBaseline, allowance);
      add(leaders.profit); add(leaders.progression);
      candidates.filter(row => row.profit >= coarseBaseline.profit - allowance).sort(byProgression).slice(0, 2).forEach(add);
      candidates.sort(byProfit).slice(0, 2).forEach(add);
      // Include both sides of the allowance for sampling uncertainty.
      for (const feasible of [true, false]) candidates.filter(row => (row.profit >= coarseBaseline.profit - allowance) === feasible)
        .sort((a, b) => Math.abs(a.profit - coarseBaseline.profit + allowance)
          - Math.abs(b.profit - coarseBaseline.profit + allowance)).slice(0, 1).forEach(add);
    }
    const baseline = estimateProgression(settings, start.step, "none", 0, runs);
    const tested = new Map<string, ProgressionCandidate>([["none:0", baseline]]);
    for (const candidate of finalists.values()) {
      if (candidate.booster === "none") continue;
      onProgress?.({ completed: rows.length, total, label: `${start.label}: checking finalists across ${runs.toLocaleString()} events` });
      tested.set(`${candidate.booster}:${candidate.quantity}`, estimateProgression(settings, start.step, candidate.booster, candidate.quantity, runs));
    }
    // Recheck nearby quantities after the higher-sample results move the budget boundary.
    const leaders = chooseProgression([...tested.values()], baseline, allowance);
    for (const center of [leaders.profit, leaders.progression]) {
      if (center.booster === "none") continue;
      for (const quantity of [center.quantity - 1, center.quantity + 1]) {
        const key = `${center.booster}:${quantity}`;
        if (quantity < 1 || quantity > progressionBoosterLimit(settings, center.booster) || tested.has(key)) continue;
        tested.set(key, estimateProgression(settings, start.step, center.booster, quantity, runs));
      }
    }
    rows.push({ step: start.step, label: start.label, basket: HALLOWEEN_BASKETS[progressionBasketIndex(start.collected)].name,
      baseline, ...chooseProgression([...tested.values()], baseline, allowance), candidates: tested.size });
    onProgress?.({ completed: rows.length, total, label: `${start.label} complete` });
  }
  return { rows, runs, allowance, calculatedAt: Date.now() };
}
