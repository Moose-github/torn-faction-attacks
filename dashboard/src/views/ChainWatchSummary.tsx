import type { ChainWatchSlot } from "../../../shared/chainWatchSchedule";
import { DEFAULT_WATCH_PAYMENT_PER_SHIFT, summarizeWatchers } from "../../../shared/chainWatchSummary";
import { formatNumber } from "../utils/format";

export function ChainWatchSummary({ slots, now, isAdmin }: { slots: ChainWatchSlot[]; now: number; isAdmin: boolean }) {
  const watchers = summarizeWatchers(slots, now);

  return <section className="panel watch-summary-panel" aria-labelledby="watch-summary-title">
    <h3 id="watch-summary-title">Watch summary</h3>
    <p className="watch-muted">Payment: ${formatNumber(DEFAULT_WATCH_PAYMENT_PER_SHIFT)} per completed assigned hourly shift. Cancelled and unfilled slots are excluded.</p>
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
          const payment = watcher.payment;
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
