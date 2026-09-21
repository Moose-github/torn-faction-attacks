import { WATCH_HOUR, type ChainWatchSlot } from "../../../shared/chainWatchSchedule";
import { formatNumber } from "../utils/format";

const DEFAULT_PAYMENT_PER_SHIFT = 10_000_000;

export function ChainWatchSummary({ slots, now, isAdmin }: { slots: ChainWatchSlot[]; now: number; isAdmin: boolean }) {
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
    <p className="watch-muted">Payment: ${formatNumber(DEFAULT_PAYMENT_PER_SHIFT)} per completed assigned hourly shift. Cancelled and unfilled slots are excluded.</p>
    {watchers.length ? <div className="watch-summary-scroll" role="region" aria-label="Watcher payments" tabIndex={0}>
      <table className={`watch-summary-table${isAdmin ? " watch-summary-table-admin" : ""}`} aria-label="Watches by watcher">
        <thead><tr>
          <th scope="col">Watcher Name</th>
          <th scope="col" className="watch-summary-number">Watcher ID</th>
          <th scope="col" className="watch-summary-number">Num Shifts</th>
          <th scope="col" className="watch-summary-number">Payment</th>
          {isAdmin ? <th scope="col">Pay</th> : null}
        </tr></thead>
        <tbody>{watchers.map(watcher => {
          const payment = watcher.count * DEFAULT_PAYMENT_PER_SHIFT;
          return <tr key={watcher.id}>
            <td>{watcher.name}</td>
            <td className="watch-summary-number">{watcher.id}</td>
            <td className="watch-summary-number">{formatNumber(watcher.count)}</td>
            <td className="watch-summary-number">${formatNumber(payment)}</td>
            {isAdmin ? <td className="watch-summary-pay"><a href={`https://www.torn.com/factions.php?step=your#/tab=controls&addMoneyTo=${watcher.id}&money=${payment}`} target="_blank" rel="noopener noreferrer">Add Money</a></td> : null}
          </tr>;
        })}</tbody>
      </table>
    </div> : <p>No completed watches were assigned.</p>}
  </section>;
}
