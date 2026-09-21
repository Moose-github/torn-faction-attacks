import { WATCH_HOUR, type ChainWatchSlot } from "./chainWatchSchedule";

export const DEFAULT_WATCH_PAYMENT_PER_SHIFT = 10_000_000;

export function summarizeWatchers(slots: ChainWatchSlot[], now: number) {
  const counts = new Map<number, { id: number; name: string; count: number }>();
  for (const slot of slots) {
    if (slot.cancelled || slot.assigned_to === null || slot.start_at + WATCH_HOUR > now) continue;
    const watcher = counts.get(slot.assigned_to);
    if (watcher) watcher.count += 1;
    else counts.set(slot.assigned_to, { id: slot.assigned_to, name: slot.member_name ?? `Player ${slot.assigned_to}`, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id - b.id)
    .map(watcher => ({ ...watcher, payment: watcher.count * DEFAULT_WATCH_PAYMENT_PER_SHIFT }));
}
