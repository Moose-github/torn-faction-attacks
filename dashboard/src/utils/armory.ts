import { weaponClass, type ArmoryCategory, type ArmoryCopy } from "../../../shared/armory";
export { weaponClass };
export function tornArmoryPositions(items: ArmoryCopy[]): Map<string, number> {
  // Use the complete category snapshot, never the filtered/grouped display order.
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    || (b.details?.stats.quality ?? -Infinity) - (a.details?.stats.quality ?? -Infinity)
    || a.uid.localeCompare(b.uid, "en", { numeric: true }));
  const firstByName = new Map<string, number>();
  return new Map(sorted.map((item, index) => {
    const name = item.name.toLowerCase();
    if (!firstByName.has(name)) firstByName.set(name, index);
    // With no quality yet, start at the name's first copy rather than guessing its rank.
    return [item.uid, item.details ? index : firstByName.get(name)!];
  }));
}
export function tornArmoryUrl(category: ArmoryCategory, start: number): string {
  return `https://www.torn.com/factions.php?step=your&type=1#/tab=armoury&start=${start}&sub=${category === "armor" ? "armour" : "weapons"}`;
}
export type ArmoryFilters = { search: string; slot: string; status: string; kind: string; rarity: string; bonus: string };
export const EMPTY_ARMORY_FILTERS: ArmoryFilters = { search: "", slot: "", status: "", kind: "", rarity: "", bonus: "" };
export const DEFAULT_ARMORY_FILTERS: ArmoryFilters = { ...EMPTY_ARMORY_FILTERS, kind: "special" };
export function filterArmory(items: ArmoryCopy[], filters: ArmoryFilters): ArmoryCopy[] {
  const search = filters.search.trim().toLowerCase();
  return items.filter(item =>
    (!search || `${item.name} ${item.uid} ${item.loaned?.name ?? ""} ${item.loaned?.id ?? ""}`.toLowerCase().includes(search)) &&
    (!filters.slot || item.type === filters.slot) &&
    (!filters.status || (item.loaned ? "loaned" : "available") === filters.status) &&
    (!filters.kind || weaponClass(item) === filters.kind) &&
    (!filters.rarity || item.details?.rarity === filters.rarity) &&
    (!filters.bonus || item.details?.bonuses.some(bonus => bonus.title === filters.bonus)));
}
export type ArmoryGroup = { key: string; items: ArmoryCopy[]; grouped: boolean };
export type ArmorySort = "name" | "available" | "rarity" | "observed" | "damage" | "accuracy" | "armor" | "quality";
export type ArmorySortDirection = "asc" | "desc";
const rarityRank = (item: ArmoryCopy): number | null => !item.details ? null : item.details.rarity === null ? 0
  : ({ yellow: 1, orange: 2, red: 3 } as Record<string, number>)[item.details.rarity] ?? null;
const observedLoan = (item: ArmoryCopy): number | null => item.loaned ? item.loan_first_seen_at : null;
export function groupArmory(items: ArmoryCopy[], individual: boolean, sort: ArmorySort, direction: ArmorySortDirection = "asc"): ArmoryGroup[] {
  const multiplier = direction === "asc" ? 1 : -1;
  // Missing observations and stats always follow known values in either direction.
  const compareValues = (a: number | null, b: number | null): number =>
    a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * multiplier;
  const groups = new Map<string, ArmoryGroup>();
  for (const item of items) {
    const grouped = !individual && weaponClass(item) === "standard";
    const key = grouped ? `model-${item.id}` : `uid-${item.uid}`;
    const group = groups.get(key) ?? { key, items: [], grouped };
    group.items.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => (sort === "observed" ? compareValues(observedLoan(a), observedLoan(b)) : 0) ||
      a.uid.localeCompare(b.uid, undefined, { numeric: true }));
  }
  const value = (group: ArmoryGroup): number | null => sort === "available" ? group.items.filter(item => !item.loaned).length
    : sort === "rarity" ? rarityRank(group.items[0])
    : sort === "observed" ? observedLoan(group.items[0])
    : sort === "name" ? 0 : group.items[0].details?.stats[sort] ?? null;
  return [...groups.values()].sort((a, b) => {
    const names = a.items[0].name.localeCompare(b.items[0].name);
    const delta = sort === "name" ? names * multiplier : compareValues(value(a), value(b));
    return delta || names ||
      Number(a.grouped) - Number(b.grouped) || a.items[0].uid.localeCompare(b.items[0].uid, undefined, { numeric: true });
  });
}
export function armoryCounts(items: ArmoryCopy[]) {
  const loaned = items.filter(item => item.loaned);
  return { total: items.length, available: items.length - loaned.length, loaned: loaned.length,
    borrowers: new Set(loaned.map(item => item.loaned!.id)).size,
    bonuses: items.filter(item => item.details?.bonuses.length).length };
}
export function loanElapsed(firstSeen: number, currentTime = Date.now() / 1000): string {
  const minutes = Math.max(0, Math.floor((currentTime - firstSeen) / 60));
  if (minutes < 1) return "Less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
export function activityElapsed(timestamp: number | null | undefined, currentTime = Date.now() / 1000): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const seconds = Math.max(0, currentTime - timestamp);
  for (const [unit, duration] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
    const amount = Math.floor(seconds / duration);
    if (amount > 0) return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  }
  return "less than a minute";
}
export function armoryCsv(items: ArmoryCopy[]): string {
  const cell = (value: unknown) => {
    let string = String(value ?? "");
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(string)) string = `'${string}`;
    return `"${string.replace(/"/g, '""')}"`;
  };
  return [["UID", "Model ID", "Item", "Slot", "Status", "Borrower ID", "Borrower", "Classification", "Rarity", "Damage", "Accuracy", "Armor", "Quality %", "Bonuses", "Loan first observed (UTC)", "Time since first observed"],
    ...items.map(item => [item.uid, item.id, item.name, item.type, item.loaned ? "Loaned" : "Available", item.loaned?.id,
      item.loaned?.name, weaponClass(item), item.details?.rarity, item.details?.stats.damage, item.details?.stats.accuracy,
      item.details?.stats.armor, item.details?.stats.quality, item.details?.bonuses.map(bonus => `${bonus.title} (${bonus.value}): ${bonus.description}`).join("; "),
      item.loaned && item.loan_first_seen_at ? new Date(item.loan_first_seen_at * 1000).toISOString() : "",
      item.loaned && item.loan_first_seen_at ? loanElapsed(item.loan_first_seen_at) : ""])]
    .map(row => row.map(cell).join(",")).join("\r\n");
}
