import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSimulatedTreatsPerAttack, type HalloweenResult } from "../utils/halloweenProfit";
import { getHalloweenProfitDistribution, getHalloweenTreatSources, type HalloweenProfitBin } from "../utils/halloweenDistributions";
import { formatMoney } from "./BookStrategy.helpers";
import "./HalloweenDistributions.css";

const precise = (value: number) => value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
const percent = (value: number) => `${precise(value)}%`;
const count = (value: number) => value >= 1 ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : precise(value);
const rate = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  const observedRate = getSimulatedTreatsPerAttack(selected);
  const treatSources = getHalloweenTreatSources(selected);
  const singleProfit = distribution.minimum === distribution.maximum;
  const padding = singleProfit ? Math.max(1, Math.abs(distribution.minimum) * 0.01) : 0;

  return <section className="panel halloween-distributions">
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Simulation outcomes</summary>
      {open && <div className="halloween-distributions-content">
        <p className="halloween-note">{strategyName} · {selected.simulationRuns.toLocaleString()} simulated events. All results update with the selected strategy and Refine estimate.</p>
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
          <div className="halloween-distributions-column">
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
            </div>
            <div className="halloween-distribution-card halloween-treat-sources">
              <h3>Treat sources</h3>
              <p className="halloween-note">Average totals per event across the simulations. Individual runs use whole treats; their averages can include decimals.</p>
              <table className="halloween-treat-sources-table" aria-label="Average treat sources per simulated event">
                <thead><tr><th scope="col">Source</th><th scope="col">Average per event</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Attacks<small>All attack drops, including multiplier bonuses</small></th><td>{count(treatSources.attacks)}</td></tr>
                  <tr><th scope="row">Mortal Coil<small>Hourly treats</small></th><td>{count(treatSources.mortalCoil)}</td></tr>
                  <tr><th scope="row">Cashback<small>Treats returned by exchanges, including repeat exchanges</small></th><td>{count(treatSources.cashback)}</td></tr>
                  <tr><th scope="row">Freebie<small>Bonus rewards added at exchange</small></th><td>{count(treatSources.freebie)}</td></tr>
                </tbody>
                <tfoot>
                  <tr><th scope="row">Treats exchanged<small>Attacks + Mortal Coil + Cashback, less any unexchanged treats</small></th><td>{count(selected.exchangedTreats)}</td></tr>
                  <tr className="halloween-treat-total"><th scope="row">Total including Freebie<small>Treats exchanged + Freebie bonus rewards</small></th><td>{count(selected.rewardTreats)}</td></tr>
                </tfoot>
              </table>
              <p className="halloween-note">Freebie adds bonus rewards rather than treats to the basket, so it is excluded from the treats exchanged total. Each exchange applies the simulator’s whole-number rounding. Displayed figures are rounded separately.</p>
              {selected.unexchangedTreats > 0 && <p className="halloween-note">{count(selected.unexchangedTreats)} treats remain unexchanged and are excluded from both totals.</p>}
            </div>
          </div>
        </div>
      </div>}
    </details>
  </section>;
}
