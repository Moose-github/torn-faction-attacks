import { ChainBonusAttack } from "../api";
import { EmptyState } from "./Common";
import { formatDate, formatNumber } from "../utils/format";

export function ChainBonusList({
  attacks,
  compact = false,
}: {
  attacks: ChainBonusAttack[];
  compact?: boolean;
}) {
  if (attacks.length === 0) {
    return <EmptyState text="No chain bonuses" />;
  }

  return (
    <div className={compact ? "chain-bonus-compact" : "table-scroll"}>
      <table className={compact ? "chain-bonus-table compact-table" : "chain-bonus-table"}>
        {!compact ? (
          <thead>
            <tr>
              <th>Time</th>
              <th>Member</th>
              <th>Chain</th>
              <th>Raw</th>
              <th>Adjusted</th>
              <th>Removed</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {attacks.map((attack) => (
            <tr key={`chain-${attack.id}`}>
              {!compact ? <td>{formatDate(attack.started)}</td> : null}
              <td>{attack.attacker_name ?? `#${attack.attacker_id ?? "-"}`}</td>
              <td>{formatNumber(attack.chain ?? 0)}</td>
              {!compact ? <td>{formatNumber(attack.respect_gain ?? 0)}</td> : null}
              {!compact ? <td>{formatNumber(attack.adjusted_respect_gain ?? 0)}</td> : null}
              {!compact ? <td>{formatNumber(attack.respect_removed ?? 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
