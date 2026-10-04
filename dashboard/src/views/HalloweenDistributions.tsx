import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HalloweenResult } from "../utils/halloweenProfit";
import { getHalloweenProfitDistribution, type HalloweenProfitBin } from "../utils/halloweenDistributions";
import { formatMoney } from "./BookStrategy.helpers";
import "./HalloweenDistributions.css";

const precise = (value: number) => value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
const percent = (value: number) => `${precise(value)}%`;
const count = (value: number) => value >= 1 ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : precise(value);
const rate = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 5 });
const money = (value: number) => value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function ProfitTooltip({ active, payload }: { active?: boolean; payload?: { payload?: HalloweenProfitBin }[] }) {
  const bin = payload?.[0]?.payload;
  if (!active || !bin) return null;
  return <div className="halloween-distribution-tooltip">
    <strong>{bin.lower === bin.upper ? money(bin.lower) : `${money(bin.lower)} to ${money(bin.upper)}`}</strong>
    <span>{bin.count.toLocaleString()} simulations · {percent(bin.percentage)}</span>
  </div>;
}

export function HalloweenDistributions({ selected, strategyName }: { selected: HalloweenResult; strategyName: string }) {
  const [open, setOpen] = useState(false);
  const distribution = useMemo(() => getHalloweenProfitDistribution(selected.profitSamples), [selected.profitSamples]);
  const attackTreats = selected.treatDrops.reduce((sum, drop) => sum + drop.treats * drop.attacks, 0);
  const observedRate = selected.attacks ? attackTreats / selected.attacks : 0;
  const singleProfit = distribution.minimum === distribution.maximum;
  const padding = singleProfit ? Math.max(1, Math.abs(distribution.minimum) * 0.01) : 0;

  return <section className="panel halloween-distributions">
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Simulation outcomes</summary>
      {open && <div className="halloween-distributions-content">
        <p className="halloween-note">{strategyName} · {selected.simulationRuns.toLocaleString()} simulated events. Both distributions update with the selected strategy and Refine estimate.</p>
        <div className="halloween-distributions-grid">
          <div className="halloween-distribution-card">
            <h3>Treats dropped per attack</h3>
            <p className="halloween-note">Attack drops only. Mortal Coil, Cashback and Freebie are excluded. Every possible outcome is shown, including outcomes not observed in these runs.</p>
            <div className="halloween-drop-summary">
              <span>Simulated average <strong>{rate(observedRate)}</strong></span>
              <span>Theoretical average <strong>{rate(selected.treatsPerAttack)}</strong></span>
              <span className="halloween-note">treats per attack</span>
            </div>
            <table className="halloween-drop-table" aria-label="Treat drops across simulated attacks">
              <thead><tr><th scope="col">Treats</th><th scope="col">Share of attacks</th><th scope="col">Avg. attacks<br />per event</th></tr></thead>
              <tbody>{selected.treatDrops.map(drop => {
                const share = selected.attacks ? drop.attacks / selected.attacks * 100 : 0;
                return <tr key={drop.treats}>
                  <th scope="row">{drop.treats}</th>
                  <td><div className="halloween-drop-frequency">
                    <span className="halloween-drop-track" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
                    <span>{percent(share)}</span>
                  </div></td>
                  <td>{count(drop.attacks)}</td>
                </tr>;
              })}</tbody>
            </table>
            <p className="halloween-note">Bar lengths use a linear 0–100% scale. Percentages pool all attacks across the simulations; counts are averages for one event. Cat in Hell remains excluded.</p>
          </div>
          <div className="halloween-distribution-card">
            <h3>Profit distribution</h3>
            <p className="halloween-note">Each bar shows the share of simulated events in that net-profit range, after costs.</p>
            <dl className="halloween-profit-summary">
              <div><dt>Average</dt><dd>{formatMoney(selected.profit)}</dd></div>
              <div><dt>Median</dt><dd>{formatMoney(distribution.median)}</dd></div>
              <div><dt>Likely range · middle 80%</dt><dd>{formatMoney(selected.profitRange.low)} to {formatMoney(selected.profitRange.high)}</dd></div>
            </dl>
            <div className="halloween-profit-histogram" role="img" aria-label={`Net profit distribution across ${selected.simulationRuns} simulated events. Median ${money(distribution.median)}. Middle 80% from ${money(selected.profitRange.low)} to ${money(selected.profitRange.high)}.`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution.bins} margin={{ top: 16, right: 12, bottom: 24, left: 0 }} barCategoryGap="8%">
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="midpoint" type="number" domain={[distribution.minimum - padding, distribution.maximum + padding]} tickFormatter={formatMoney} stroke="var(--chart-axis)" tickCount={4} minTickGap={20} label={{ value: "Event net profit", position: "bottom", offset: 6, fill: "var(--text-muted)", fontSize: 12 }} />
                  <YAxis tickFormatter={percent} stroke="var(--chart-axis)" width={44} />
                  {!singleProfit && <ReferenceArea x1={selected.profitRange.low} x2={selected.profitRange.high} fill="#fb923c" fillOpacity={0.12} />}
                  <Tooltip content={<ProfitTooltip />} cursor={{ fill: "var(--panel-hover-bg)" }} />
                  <Bar dataKey="percentage" name="Share of simulations" fill="#38bdf8" maxBarSize={64} isAnimationActive={false} />
                  <ReferenceLine x={distribution.median} stroke="#fb923c" strokeWidth={2} strokeDasharray="4 4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="halloween-note">{singleProfit ? "All simulated events returned the same net profit." : "The shaded area marks the middle 80% of results. The dashed line marks the median: half the results are on either side."} Prices are held fixed; variation comes from treat drops and Revitalize where applicable.</p>
            <details className="halloween-profit-data"><summary>View profit ranges and counts</summary>
              <table className="halloween-profit-bin-table"><thead><tr><th scope="col">Profit range</th><th scope="col">Runs</th><th scope="col">Share</th></tr></thead>
                <tbody>{distribution.bins.map((bin, index) => <tr key={index}>
                  <th scope="row">{bin.lower === bin.upper ? money(bin.lower) : `${money(bin.lower)} – ${money(bin.upper)}`}</th>
                  <td>{bin.count.toLocaleString()}</td><td>{percent(bin.percentage)}</td>
                </tr>)}</tbody>
              </table>
              <p className="halloween-note">Each range includes its lower boundary; the final range also includes its upper boundary.</p>
            </details>
          </div>
        </div>
      </div>}
    </details>
  </section>;
}
