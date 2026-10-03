import React from "react";
import { BatteryCharging, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PanelHeader } from "../components/Common";
import { NumberField } from "../components/TrainingCalculatorInputs";
import type { BookStrategyInputs } from "../utils/bookStrategy";
import { ENERGY_DRINK_TIERS, type EnergyDrinkForm, type EnergyDrinkSettings } from "../utils/energyDrinkStrategy";
import { calculateHalloweenTier, HALLOWEEN_SEARCH_DAYS, MAX_BASKET_TREATS_PER_ATTACK } from "../utils/halloweenStrategy";
import { formatCompact, formatMoney, formatStat, parseNumber, type BookStrategyForm } from "./BookStrategy.helpers";

type Props = {
  inputs: BookStrategyInputs;
  form: BookStrategyForm;
  drinks: EnergyDrinkForm;
  settings: EnergyDrinkSettings;
  invalid: string | null;
  onDrinksChange: React.Dispatch<React.SetStateAction<EnergyDrinkForm>>;
  onFieldChange: <K extends keyof BookStrategyForm>(field: K, value: BookStrategyForm[K]) => void;
};

export function HalloweenStrategy({ inputs, form, drinks, settings, invalid, onDrinksChange, onFieldChange }: Props) {
  const treatPrice = parseNumber(drinks.treatPrice, NaN);
  const rewardError = !Number.isFinite(treatPrice) || treatPrice < 0 || treatPrice > 1e8
    ? "Enter a price per treat between $0 and $100m." : null;
  const timingError = form.enhancerMode === "targetDay" && inputs.enhancerUseMode.kind === "targetDay" && inputs.enhancerUseMode.day > HALLOWEEN_SEARCH_DAYS
    ? "Halloween projections support enhancer purchases up to day 3,650." : null;
  const rows = React.useMemo(() => invalid || rewardError || timingError ? [] : ENERGY_DRINK_TIERS.map((tier, index) =>
    calculateHalloweenTier(inputs, tier.energy, parseNumber(drinks.prices[index], NaN), {
      factionPercent: settings.factionPercent, company: settings.company,
      maxCooldownHours: settings.maxCooldownHours, startingCooldownHours: settings.startingCooldownHours,
      spendingCap: settings.spendingCap,
    }, treatPrice)), [inputs, drinks.prices, settings.factionPercent, settings.company, settings.maxCooldownHours, settings.startingCooldownHours, settings.spendingCap, treatPrice, invalid, rewardError, timingError]);
  const selected = rows[drinks.selectedTier];
  const validRows = rows.filter((row) => row !== null);
  const bestCash = validRows.reduce<(typeof validRows)[number] | null>((best, row) => !best || row.netExtraCash > best.netExtraCash ? row : best, null);
  const strongest = validRows.reduce<(typeof validRows)[number] | null>((best, row) => !best || row.endpoint.cansStat > best.endpoint.cansStat ? row : best, null);

  return <>
    <section className="panel book-strategy-panel" aria-label="Halloween reward assumptions">
      <PanelHeader icon={<TrendingUp size={17} />} title="Halloween rewards" />
      <div className="halloween-reward-input">
        <NumberField label="Price per treat" value={drinks.treatPrice} onChange={(value) => onDrinksChange((current) => ({ ...current, treatPrice: value }))} suffix="$/treat" />
        <p className="drink-note">Default: $750,000 per treat earned. Enter the average net sale proceeds per treat, including Freebie and Cashback benefits after selling fees. Proceeds equal treats earned × price per treat. Returned energy adds further attacks and treats separately; exclude its value from this price.</p>
      </div>
      <p className="drink-note">Expected {MAX_BASKET_TREATS_PER_ATTACK.toFixed(5)} treats per successful attack before exchange recycling. Assumes scary clothing and a scary finishing weapon, frequent exchanges, and all Dark Power energy used for more attacks. Normal-energy and Mortal Coil rewards are included equally in both strategies.</p>
      {rewardError || timingError ? <p className="drink-error" role="alert">{rewardError ?? timingError}</p> : null}
    </section>

    <section className="panel book-strategy-panel" aria-label="Halloween can tier comparison">
      <PanelHeader icon={<BatteryCharging size={17} />} title="Compare Halloween can tiers" />
      <p className="drink-note">Extra attacks, treats and proceeds are above the no-cans baseline, including exchange recycling. Default can prices are based on the annual low point, not live market prices, and can be edited. Stats shown here are gym gains before enhancers.</p>
      <div className="drink-table-scroll" tabIndex={0} role="region" aria-label="Scrollable Halloween comparison">
        <table className="drink-table halloween-table"><thead><tr>
          <th scope="col">Can tier</th><th scope="col">Price per can</th><th scope="col">Cans / spend</th><th scope="col">Halloween energy</th><th scope="col">Extra attacks / treats</th><th scope="col">Extra sale proceeds</th><th scope="col">Day-31 gym lead</th><th scope="col">First saving overtake</th>
        </tr></thead><tbody>{ENERGY_DRINK_TIERS.map((tier, index) => {
          const row = rows[index];
          return <tr key={tier.energy} className={index === drinks.selectedTier ? "is-selected" : ""}>
            <th scope="row"><button className="drink-tier-button" aria-pressed={index === drinks.selectedTier} onClick={() => onDrinksChange((current) => ({ ...current, selectedTier: index }))}>{tier.energy}E tier</button><small>{tier.name}</small></th>
            <td><NumberField label={`${tier.energy}E can price`} value={drinks.prices[index]} onChange={(value) => onDrinksChange((current) => ({ ...current, prices: current.prices.map((price, i) => i === index ? value : price) }))} /></td>
            {row ? <>
              <td>{formatCompact(row.plan.totalFhcs)} cans<small>{formatMoney(row.plan.cost)} total</small></td>
              <td>{formatCompact(row.eventCanEnergy)}E<small>{row.eventCans} cans in event</small></td>
              <td>≈{formatCompact(row.extraRewards.attacks)} attacks<small>≈{formatCompact(row.extraRewards.earnedTreats)} treats earned</small></td>
              <td>{formatMoney(row.extraProceeds)}<small>{row.netExtraCash >= 0 ? "+" : "−"}{formatMoney(Math.abs(row.netExtraCash))} after all can costs</small></td>
              <td>{formatStat(row.bookEndGymLead)}<small>{formatCompact(row.gymCanEnergy)}E trained</small></td>
              <td>{row.plan.totalFhcs === 0 ? "No cans purchased" : row.firstSavingOvertakeDay === null ? "Not within 3,650 days" : `Day ${formatCompact(row.firstSavingOvertakeDay)}`}<small>Both buy enhancers together</small></td>
            </> : <td colSpan={6}>{invalid || rewardError || timingError ? "Check inputs above" : "Enter a positive can price; projected purchases must stay below 10,000 enhancers."}</td>}
          </tr>;
        })}</tbody></table>
      </div>
      {bestCash && strongest && validRows.some((row) => row.plan.totalFhcs > 0) ? <p className="drink-verdict"><strong>Largest cash advantage: {bestCash.base}E tier.</strong> Highest can-strategy stat at the graph end: <strong>{strongest.base}E tier.</strong> Based on your prices and enhancer timing.</p> : null}
    </section>

    {selected ? <>
      <section className="panel book-strategy-panel" aria-label="Halloween strategy results">
        <PanelHeader icon={<TrendingUp size={17} />} title={`${selected.base}E cans: Halloween vs saving`} />
        <div className="drink-metrics">
          <Metric label="Extra Halloween proceeds" value={formatMoney(selected.extraProceeds)} detail={`From ≈${formatCompact(selected.extraRewards.attacks)} extra attacks`} />
          <Metric label="Proceeds minus all can costs" value={`${selected.netExtraCash < 0 ? "−" : "+"}${formatMoney(Math.abs(selected.netExtraCash))}`} detail="Cash difference before investment or enhancers" />
          <Metric label="Day-31 gym advantage" value={formatStat(selected.bookEndGymLead)} detail={`${formatStat(selected.gymGainsForgone)} potential gym gain forgone by attacking with cans`} />
          <Metric label={`Stat lead at day ${selected.endpoint.day}`} value={formatStat(Math.abs(selected.endpoint.difference))} detail={Math.abs(selected.endpoint.difference) < 0.5 ? "Strategies tied" : selected.endpoint.difference > 0 ? "Saving strategy ahead" : "Halloween cans ahead"} />
        </div>
        <div className="halloween-funding" aria-label="Enhancer funding comparison">
          <Funding label="Halloween cans" proceeds={selected.canProceeds} baseline={selected.baselineProceeds} principal={0} enhancers={selected.purchase.cansEnhancers} cash={selected.purchase.cansCashLeft} />
          <Funding label="Save the can money" proceeds={selected.baselineProceeds} baseline={selected.baselineProceeds} principal={selected.plan.cost} enhancers={selected.purchase.savingsEnhancers} cash={selected.purchase.savingsCashLeft} />
        </div>
        <p className="drink-note">{selected.purchase.day === null ? "The saving strategy does not reach the selected stat within 3,650 days, so neither strategy buys enhancers in this projection." : `Both buy whole enhancers on day ${selected.purchase.day}${selected.purchase.day > selected.inputs.graphDurationDays ? ", beyond the displayed graph" : ""}.`}{" "}
          {form.enhancerMode === "earliestOvertake" && selected.firstSavingOvertakeDay === null ? "No saving overtake was found in the ten-year search, so automatic mode uses day 31." : null}
        </p>
        <div className="drink-chart" role="img" aria-label={`Halloween stat projection for ${selected.base}E cans`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={selected.series} margin={{ top: 20, right: 16, bottom: 10, left: 0 }} onClick={(state) => {
            const day = Number(state?.activeLabel);
            if (Number.isFinite(day) && day >= 31) { onFieldChange("enhancerMode", "targetDay"); onFieldChange("enhancerTargetDay", String(Math.round(day))); }
          }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="day" type="number" domain={[0, selected.inputs.graphDurationDays]} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={formatCompact} />
            <YAxis width={62} domain={["auto", "auto"]} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={formatStat} />
            <Tooltip formatter={(value: number) => formatStat(value)} labelFormatter={(value) => `Day ${formatCompact(Number(value))}`} contentStyle={{ background: "var(--chart-tooltip-bg)", borderColor: "var(--chart-tooltip-border)", borderRadius: 8 }} />
            <Legend />
            <ReferenceArea x1={0} x2={7} fill="#f97316" fillOpacity={0.18} />
            <ReferenceArea x1={7} x2={31} fill="#38bdf8" fillOpacity={0.08} />
            <ReferenceLine x={31} stroke="var(--chart-axis)" strokeDasharray="4 4" />
            {selected.purchase.day !== null && selected.purchase.day <= selected.inputs.graphDurationDays ? <ReferenceLine x={selected.purchase.day} stroke="#f59e0b" strokeDasharray="4 4" /> : null}
            <Line name="Halloween cans + enhancers" dataKey="cansStat" type="linear" stroke="#38bdf8" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line name="Save + enhancers" dataKey="savingsStat" type="linear" stroke="#f59e0b" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </div>
        <p className="drink-note">Days 0–7: all energy attacks. Days 7–31: gym training with the book. After day 31: your normal training rotation. Click the graph after day 31 to choose a purchase day.</p>
        {selected.firstSavingOvertakeDay !== null && selected.firstSavingOvertakeDay > selected.inputs.graphDurationDays ? <button className="panel-action-button" onClick={() => onFieldChange("graphDurationDays", String(Math.min(3650, selected.firstSavingOvertakeDay! + 30)))}>Extend graph to saving overtake</button> : null}
      </section>

      <details className="panel drink-methodology"><summary>Halloween methodology & assumptions</summary>
        <p>The 31-day book starts with the full 168-hour Halloween event. Both paths attack with all starting and normal daily energy during the event, succeed every time and train afterward. Only the can path adds boosted cans. A can at the exact end of Halloween is trained. The training-only mode is a separate comparison for using the book away from Halloween.</p>
        <p>A fully upgraded Nightmarish basket, scary clothing and scary finishing weapon give an expected {MAX_BASKET_TREATS_PER_ATTACK.toFixed(5)} treats per attack. No Revitalize energy refund is assumed. Mortal Coil contributes 168 shared treats; one-time upgrade rewards and previously held treats are excluded.</p>
        <p>Freebie adds 10% to rewards and Dark Power energy; Cashback returns 10% of the original exchanged treats. Returned energy is attacked and resulting treats exchanged again. These are long-run expected values: fractional attacks and rewards are estimates, and exchange rounding and random variation are not simulated.</p>
        <p>Frequent exchanges and prompt attacks are assumed to avoid the 1,000-energy cap. Treats are not banked, so no Inflation income is credited. Returned energy is used only for attacks during Halloween, never also counted as gym energy or cash. Reward cans are sold, not consumed again.</p>
        <p>Price per treat is the net average sale proceeds per earned treat, including premium rewards, multipacks, Freebie and Cashback. Proceeds equal earned treats × this price; Cashback treats and Freebie rewards are not priced again. Dark Power energy still generates additional attacks and earned treats, so its value must be excluded from the price. All proceeds become available on day 7. With investment enabled, saved can money grows from day 0 and both paths’ event proceeds grow from day 7.</p>
        <p>Both paths use their own balances to buy whole enhancers on the same day, at or after day 31. The first saving overtake is the first daily checkpoint where buying then puts saving ahead of cans buying then. If none is found within 3,650 days, automatic mode buys on day 31; this does not claim saving can never win. A chosen target stat uses the saving path before enhancers.</p>
        <p>Enhancer purchases are one event; individual booster cooldowns are not simulated. Each enhancer adds 1%, capped at 5 trillion per item. Leftover cash remains cash. Gym projections use the existing formula, fixed happiness, 50-energy trains and no 30% gym-book bonus. No later Halloween events are simulated.</p>
        <p>“Gym gain forgone” compares training the Halloween can energy instead, while keeping normal Halloween attacks identical. “Proceeds minus all can costs” subtracts the entire 31-day can bill; the remaining can energy still supplies gym gains.</p>
        <p>Sources: <a href="https://wiki.torn.com/wiki/Trick_or_Treat" target="_blank" rel="noreferrer">Torn Wiki basket upgrades</a>, <a href="https://www.torn.com/forums.php?p=threads&amp;f=61&amp;t=16504610" target="_blank" rel="noreferrer">event duration and exchange mechanics</a>, <a href="https://wiki.torn.com/wiki/Item_Cooldown" target="_blank" rel="noreferrer">enhancer cap</a>.</p>
      </details>
    </> : null}
  </>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="drink-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Funding({ label, proceeds, baseline, principal, enhancers, cash }: { label: string; proceeds: number; baseline: number; principal: number; enhancers: number; cash: number | null }) {
  return <div className="halloween-funding-card"><h3>{label}</h3><dl>
    <div><dt>Can money saved from day 0</dt><dd>{formatMoney(principal)}</dd></div>
    <div><dt>Shared Halloween proceeds</dt><dd>{formatMoney(baseline)}</dd></div>
    <div><dt>Additional can-funded proceeds</dt><dd>{formatMoney(proceeds - baseline)}</dd></div>
    <div><dt>Enhancers at selected purchase</dt><dd>{cash === null ? "No purchase" : enhancers}</dd></div>
    <div><dt>Cash left after purchase</dt><dd>{cash === null ? "—" : formatMoney(cash)}</dd></div>
  </dl></div>;
}
