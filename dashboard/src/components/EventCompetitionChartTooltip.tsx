import { formatDate, formatNumber } from "../utils/format";
import type { EventCompetitionChartPoint } from "../utils/eventCompetitionChart";

export function EventCompetitionChartTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: EventCompetitionChartPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="event-chart-tooltip" role="tooltip">
    <div className="event-chart-tooltip-heading">{formatDate(point.observed_at)}</div>
    <div className="event-chart-tooltip-metric">
      <span className="event-chart-swatch event-chart-swatch-treats" aria-hidden="true" />
      <span>Treats gained</span>
      <strong>{point.treats_gained === null ? "No reading" : formatNumber(point.treats_gained)}</strong>
      <small>{point.treats_sampled_at === null ? "Awaiting first reading" : `Collected ${formatDate(point.treats_sampled_at)}`}</small>
    </div>
    <div className="event-chart-tooltip-metric">
      <span className="event-chart-swatch event-chart-swatch-chain" aria-hidden="true" />
      <span>Chain</span>
      <strong>{point.chain === null ? "No reading" : formatNumber(point.chain)}</strong>
      <small>{point.chain === null || point.chain_sampled_at === null ? "No reliable sample for this hour" : `Sampled ${formatDate(point.chain_sampled_at)}`}</small>
    </div>
    {point.successful_attacks !== null ? <div className="event-chart-tooltip-metric">
      <span className="event-chart-swatch event-chart-swatch-attacks" aria-hidden="true" />
      <span>Successful attacks</span>
      <strong>{formatNumber(point.successful_attacks)}</strong>
      <small>Total since event start · {formatDate(point.attacks_sampled_at!)}</small>
    </div> : null}
  </div>;
}
