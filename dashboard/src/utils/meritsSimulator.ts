import { MERIT_DEFINITIONS, type MeritDefinition } from "./meritDefinitions";

export const meritCost = (level: number): number => level * (level + 1) / 2;
export const validMeritLevel = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10;
export type MeritSnapshot = { definitions: MeritDefinition[]; levels: number[]; budget: number; used: number };
export type MeritState = MeritSnapshot & { baseline: number[]; history: number[][]; imported: boolean };
export type MeritAction = { type: "level"; index: number; level: number } | { type: "budget"; budget: number }
  | { type: "import"; snapshot: MeritSnapshot } | { type: "undo" | "reset" | "clear" };

export function initialMeritState(): MeritState {
  const levels = MERIT_DEFINITIONS.map(() => 0);
  return { definitions: MERIT_DEFINITIONS, levels, baseline: levels, budget: 0, used: 0, history: [], imported: false };
}

export function meritReducer(state: MeritState, action: MeritAction): MeritState {
  if (action.type === "import") return { ...action.snapshot, baseline: [...action.snapshot.levels], history: [], imported: true };
  if (action.type === "budget") return Number.isSafeInteger(action.budget) && action.budget >= 0 && action.budget <= 99999
    ? { ...state, budget: action.budget } : state;
  if (action.type === "level") {
    if (!Number.isInteger(action.index) || state.levels[action.index] === undefined || !validMeritLevel(action.level) || state.levels[action.index] === action.level) return state;
    const levels = [...state.levels];
    levels[action.index] = action.level;
    return { ...state, levels, used: state.used + meritCost(action.level) - meritCost(state.levels[action.index]), history: [...state.history.slice(-99), state.levels] };
  }
  const levels = action.type === "undo" ? state.history[state.history.length - 1] : action.type === "reset" ? state.baseline : state.levels.map(() => 0);
  if (!levels || levels.every((level, index) => level === state.levels[index])) return state;
  return { ...state, levels: [...levels], used: levels.reduce((total, level) => total + meritCost(level), 0),
    history: action.type === "undo" ? state.history.slice(0, -1) : [...state.history.slice(-99), state.levels] };
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function natural(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

/** Match official merit IDs through the catalog instead of assuming its order or guessing IDs. */
export function parseMeritImport(userData: unknown, catalogData: unknown): MeritSnapshot {
  if (!record(userData) || !record(userData.merits) || !Array.isArray(userData.merits.upgrades)
    || !natural(userData.merits.used) || !natural(userData.merits.available)
    || !record(catalogData) || !Array.isArray(catalogData.merits) || !catalogData.merits.length) {
    throw new Error("Torn returned incomplete merit information. Your current plan has been kept.");
  }
  const catalog = new Map<number, { name: string; description: string }>();
  for (const item of catalogData.merits) {
    if (!record(item) || !natural(item.id) || typeof item.name !== "string" || !item.name.trim() || catalog.has(item.id)) {
      throw new Error("Torn returned an invalid merit catalog. Your current plan has been kept.");
    }
    catalog.set(item.id, { name: item.name, description: typeof item.description === "string" ? item.description.replace(/<[^>]*>/g, "") : "" });
  }
  const upgrades = new Map<number, number>();
  for (const item of userData.merits.upgrades) {
    if (!record(item) || !natural(item.id) || !catalog.has(item.id) || !validMeritLevel(item.level) || upgrades.has(item.id)) {
      throw new Error("Torn returned an unsupported merit upgrade. Your current plan has been kept.");
    }
    upgrades.set(item.id, item.level);
  }
  const rows = [...catalog].map(([id, item]) => {
    const known = MERIT_DEFINITIONS.find(definition => normalize(definition.name) === normalize(item.name));
    const definition: MeritDefinition = known ? { ...known, key: String(id), name: item.name,
      description: known.multiplier === null ? item.description || known.description : known.description } : {
      key: String(id), name: item.name, description: item.description, group: "Other",
      multiplier: null, unit: "", multiplier2: null, unit2: "",
    };
    return { definition, level: upgrades.get(id) ?? 0 };
  });
  const used = rows.reduce((total, row) => total + meritCost(row.level), 0);
  if (used !== userData.merits.used) throw new Error("Torn's upgrade levels and used-merit total do not match. Your current plan has been kept; try importing again.");
  const budget = used + userData.merits.available;
  if (!Number.isSafeInteger(budget) || budget > 99999) throw new Error("Torn returned an unsupported merit total.");
  return { definitions: rows.map(row => row.definition), levels: rows.map(row => row.level), budget, used };
}

export function meritEffect(definition: MeritDefinition, level: number): string {
  const { multiplier, unit, multiplier2, unit2 } = definition;
  if (multiplier === null) return definition.description || "Bonus details unavailable; allocation costs are included.";
  const format = (multiple: number, suffix: string) => `${Number((level * multiple).toFixed(2))}${suffix}`;
  const amount = format(multiplier, unit);
  if (multiplier2 !== null) return `${amount} damage and ${format(multiplier2, unit2)} accuracy`;
  if (definition.group === "Combat") return `${amount} passive ${definition.name === "Brawn" ? "strength" : definition.name === "Protection" ? "defense" : definition.name === "Sharpness" ? "speed" : "dexterity"}`;
  return `${definition.description} ${amount}${definition.name === "Nerve Bar" ? " points" : ""}`.trim();
}
