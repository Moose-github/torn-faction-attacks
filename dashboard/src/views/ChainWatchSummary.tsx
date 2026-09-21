import { WATCH_HOUR, type ChainWatchSlot } from "../../../shared/chainWatchSchedule";

export function ChainWatchSummary({ slots, now }: { slots: ChainWatchSlot[]; now: number }) {
  const counts = new Map<number, { id: number; name: string; count: number }>();
  for (const slot of slots) {
    if (slot.cancelled || slot.assigned_to === null || slot.start_at + WATCH_HOUR > now) continue;
    const watcher = counts.get(slot.assigned_to);
    if (watcher) watcher.count += 1;
    else counts.set(slot.assigned_to, { id: slot.assigned_to, name: slot.member_name ?? `Player ${slot.assigned_to}`, count: 1 });
  }
  const watchers = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id - b.id);

  return <section className="panel watch-summary-panel" aria-labelledby="watch-summary-title">
    <h3 id="watch-summary-title">Watch summary</h3>
    <p className="watch-muted">One watch per completed hourly slot assigned. Cancelled and unfilled slots are excluded.</p>
    {watchers.length ? <table className="watch-summary-table" aria-label="Watches by watcher">
      <thead><tr><th scope="col">Watcher</th><th scope="col">Watches</th></tr></thead>
      <tbody>{watchers.map(watcher => <tr key={watcher.id}><td>{watcher.name}</td><td>{watcher.count}</td></tr>)}</tbody>
    </table> : <p>No completed watches were assigned.</p>}
  </section>;
}
