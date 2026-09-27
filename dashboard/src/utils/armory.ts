import { weaponClass, type ArmoryCopy } from "../../../shared/armory";
export { weaponClass };
export type ArmoryFilters = { search: string; slot: string; status: string; kind: string; rarity: string; bonus: string };
export const EMPTY_ARMORY_FILTERS: ArmoryFilters = { search: "", slot: "", status: "", kind: "", rarity: "", bonus: "" };
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
export type ArmorySort = "name" | "quantity" | "available" | "loaned" | "damage" | "accuracy" | "quality";
export function groupArmory(items: ArmoryCopy[], individual: boolean, sort: ArmorySort): ArmoryGroup[] {
  const groups = new Map<string, ArmoryGroup>();
  for (const item of items) {
    const grouped = !individual && weaponClass(item) === "standard";
    const key = grouped ? `model-${item.id}` : `uid-${item.uid}`;
    const group = groups.get(key) ?? { key, items: [], grouped };
    group.items.push(item);
    groups.set(key, group);
  }
  const value = (group: ArmoryGroup): number => sort === "quantity" ? group.items.length
    : sort === "available" ? group.items.filter(item => !item.loaned).length
    : sort === "loaned" ? group.items.filter(item => item.loaned).length
    : sort === "name" ? 0 : group.items[0].details?.stats[sort] ?? -Infinity;
  return [...groups.values()].sort((a, b) => {
    const delta = value(b) - value(a);
    return (Number.isNaN(delta) ? 0 : delta) || a.items[0].name.localeCompare(b.items[0].name) ||
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
export function armoryCsv(items: ArmoryCopy[]): string {
  const cell = (value: unknown) => {
    let string = String(value ?? "");
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(string)) string = `'${string}`;
    return `"${string.replace(/"/g, '""')}"`;
  };
  return [["UID", "Model ID", "Weapon", "Slot", "Status", "Borrower ID", "Borrower", "Classification", "Rarity", "Damage", "Accuracy", "Quality %", "Bonuses", "Loan first observed (UTC)", "Time since first observed"],
    ...items.map(item => [item.uid, item.id, item.name, item.type, item.loaned ? "Loaned" : "Available", item.loaned?.id,
      item.loaned?.name, weaponClass(item), item.details?.rarity, item.details?.stats.damage, item.details?.stats.accuracy,
      item.details?.stats.quality, item.details?.bonuses.map(bonus => `${bonus.title} (${bonus.value}): ${bonus.description}`).join("; "),
      item.loaned && item.loan_first_seen_at ? new Date(item.loan_first_seen_at * 1000).toISOString() : "",
      item.loaned && item.loan_first_seen_at ? loanElapsed(item.loan_first_seen_at) : ""])]
    .map(row => row.map(cell).join(",")).join("\r\n");
}
