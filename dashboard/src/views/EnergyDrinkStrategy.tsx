import React from "react";
import { BatteryCharging, CircleDollarSign, SlidersHorizontal, Sparkles, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PanelHeader } from "../components/Common";
import { NumberField, PerkInputs, PopoutButton } from "../components/TrainingCalculatorInputs";
import { calculateBookStrategy, type BookStrategyInputs } from "../utils/bookStrategy";
import {
  calculateEnergyDrinkTier, drinkCooldownHours, ENERGY_DRINK_TIERS,
  type DrinkCompany, type EnergyDrinkForm, type EnergyDrinkSettings,
} from "../utils/energyDrinkStrategy";
import { formatCompact, formatInputCompact, formatMoney, formatStat, parseNumber, type BookStrategyForm, type SharedTrainingSettings } from "./BookStrategy.helpers";
import "./EnergyDrinkStrategy.css";
import { HalloweenStrategy, useHalloweenStrategies } from "./HalloweenStrategy";

// Keep the Halloween implementation available for a future dedicated calculator.
const HALLOWEEN_OVERLAP_ENABLED = false;

type Props = {
  inputs: BookStrategyInputs;
  form: BookStrategyForm;
  drinks: EnergyDrinkForm;
  onDrinksChange: React.Dispatch<React.SetStateAction<EnergyDrinkForm>>;
  onFieldChange: <K extends keyof BookStrategyForm>(field: K, value: BookStrategyForm[K]) => void;
  sharedSettings: SharedTrainingSettings;
  onSharedSettingChange: <K extends keyof SharedTrainingSettings>(field: K, value: SharedTrainingSettings[K]) => void;
  energyControls: React.ReactNode;
};

export function EnergyDrinkStrategy({ inputs, form, drinks: drinkForm, onDrinksChange, onFieldChange, sharedSettings, onSharedSettingChange, energyControls }: Props) {
  const drinks: EnergyDrinkForm = HALLOWEEN_OVERLAP_ENABLED ? drinkForm : { ...drinkForm, scenario: "training" };
  const [popout, setPopout] = React.useState<"energy" | "perks" | "cans" | "investment" | null>(null);
  const number = (value: string) => parseNumber(value, Number.NaN);
  const settings: EnergyDrinkSettings = {
    factionPercent: number(drinks.factionPercent), company: drinks.company,
    maxCooldownHours: number(drinks.maxCooldownHours), startingCooldownHours: number(drinks.startingCooldownHours),
    spendingCap: null,
  };
  const invalid = validateInputs(inputs, form, settings);
  const rows = React.useMemo(() => invalid || drinks.scenario === "halloween" ? [] : ENERGY_DRINK_TIERS.map((tier, index) =>
    calculateEnergyDrinkTier({ ...inputs, enhancerUseMode: { kind: "earliestOvertake" } }, tier.energy, parseNumber(drinks.prices[index], Number.NaN), {
      factionPercent: parseNumber(drinks.factionPercent, 0), company: drinks.company,
      maxCooldownHours: parseNumber(drinks.maxCooldownHours, 48), startingCooldownHours: parseNumber(drinks.startingCooldownHours, 0),
      spendingCap: null,
    })), [inputs, drinks.scenario, drinks.prices, drinks.factionPercent, drinks.company, drinks.maxCooldownHours, drinks.startingCooldownHours, invalid]);
  const selected = rows[drinks.selectedTier];
  const selectedResult = React.useMemo(() => {
    if (!selected) return null;
    return form.enhancerMode === "earliestOvertake" ? selected.strategy : calculateBookStrategy({ ...selected.inputs, enhancerUseMode: inputs.enhancerUseMode }, selected.plan);
  }, [selected, inputs.enhancerUseMode, form.enhancerMode]);
  const validRows = rows.filter((row) => row !== null);
  const bestValue = validRows.reduce<(typeof validRows)[number] | null>((best, row) => !best || row.gainPerBillion > best.gainPerBillion ? row : best, null);
  const mostGain = validRows.reduce<(typeof validRows)[number] | null>((best, row) => !best || row.strategy.bookEnd.lead > best.strategy.bookEnd.lead ? row : best, null);
  const updateDrink = <K extends keyof EnergyDrinkForm>(field: K, value: EnergyDrinkForm[K]) => onDrinksChange((current) => ({ ...current, [field]: value }));
  const earliest = selected?.strategy.enhancerUse.day;
  const purchase = selectedResult?.enhancerUse;
  const cashLeft = purchase?.investmentBalance != null ? Math.max(0, purchase.investmentBalance - purchase.enhancersUsed * inputs.statEnhancerPrice) : null;
  const halloween = useHalloweenStrategies({ inputs, form, drinks, settings, invalid });
  const halloweenPurchase = halloween.rows[drinks.selectedTier]?.purchase;
  const timingDay = drinks.scenario === "halloween" ? halloweenPurchase?.day : purchase?.day;
  const timingStat = drinks.scenario === "halloween" ? halloweenPurchase?.savingsStatBefore : purchase?.strategyTwoBeforeEnhancers;
  const useDayValue = form.enhancerMode === "targetDay" ? form.enhancerTargetDay : timingDay == null ? "" : String(Math.round(timingDay));
  const useStatValue = form.enhancerMode === "targetStat" ? form.enhancerTargetStat : timingStat == null ? "" : formatInputCompact(timingStat);
  const earliestOvertakeActive = form.enhancerMode === "earliestOvertake";

  return <div className="energy-drink-view">
    <section className="panel book-strategy-panel">
      <PanelHeader icon={<BatteryCharging size={17} />} title="Fuelling Your Way to Failure" />
      <p className="drink-note">Double energy from cans for 31 days. Compare training with boosted cans against saving the same money for stat enhancers.</p>
      {HALLOWEEN_OVERLAP_ENABLED ? <div className="drink-scenario-switch" role="group" aria-label="Energy drink scenario">
        <button className="drink-tier-button" aria-pressed={drinks.scenario === "training"} onClick={() => updateDrink("scenario", "training")}>Training only</button>
        <button className="drink-tier-button" aria-pressed={drinks.scenario === "halloween"} onClick={() => updateDrink("scenario", "halloween")}>Halloween overlap</button>
      </div> : null}
      {drinks.scenario === "halloween" ? <p className="halloween-assumptions">Max basket · Full 7-day event · All energy attacks · 100% attack success<br />Book starts with Halloween; the remaining 24 days are spent training.</p> : null}
    </section>

    <div className="book-strategy-controls">
      <section className="panel book-strategy-panel book-strategy-input-panel">
        <PanelHeader icon={<SlidersHorizontal size={17} />} title="Training & prices" control={<div className="book-strategy-popout-actions">
          <PopoutButton icon={<BatteryCharging size={15} />} label="Energy" active={popout === "energy"} onClick={() => setPopout(popout === "energy" ? null : "energy")} />
          <PopoutButton icon={<Sparkles size={15} />} label="Perks" active={popout === "perks"} onClick={() => setPopout(popout === "perks" ? null : "perks")} />
          <PopoutButton icon={<SlidersHorizontal size={15} />} label="Cans" active={popout === "cans"} onClick={() => setPopout(popout === "cans" ? null : "cans")} />
          <PopoutButton icon={<CircleDollarSign size={15} />} label="Investment" active={popout === "investment"} onClick={() => setPopout(popout === "investment" ? null : "investment")} />
        </div>} />
        <div className="book-strategy-input-grid">
          <NumberField label="Starting stat" value={form.startingStat} onChange={(v) => onFieldChange("startingStat", v)} />
          <NumberField label="Happiness" value={form.happiness} onChange={(v) => onFieldChange("happiness", v)} />
          <NumberField label="Gym dots" value={form.gymMultiplier} onChange={(v) => onFieldChange("gymMultiplier", v)} />
          <NumberField label="Graph duration (days)" value={form.graphDurationDays} onChange={(v) => onFieldChange("graphDurationDays", v)} title="31–3,650 days" />
          <NumberField label="Months spent training stat" value={form.postBookTrainingMonthsOutOfFour} onChange={(v) => onFieldChange("postBookTrainingMonthsOutOfFour", v)} title="0–4 months per four-month rotation, after the book" />
          <NumberField label="Enhancer price" value={form.statEnhancerPrice} onChange={(v) => onFieldChange("statEnhancerPrice", v)} />
          <div className="book-strategy-toggle-field">
            <span>Investment</span>
            <label className={`book-strategy-check book-strategy-investment-toggle ${form.investmentEnabled ? "" : "is-off"}`}>
              <input type="checkbox" checked={form.investmentEnabled} onChange={(e) => onFieldChange("investmentEnabled", e.target.checked)} />
              <span>Enable Investment</span>
            </label>
          </div>
        </div>
        <p className="drink-note">Training, energy, gym perks and enhancer settings are shared with FHCs vs Enhancers. Daily energy must exclude the cans being compared. No 30% gym book bonus is applied here.</p>
        {popout === "energy" ? energyControls : null}
        {popout === "perks" ? <PerkInputs settings={sharedSettings} onSettingChange={onSharedSettingChange} /> : null}
        {popout === "investment" ? <div className="book-strategy-popout" role="dialog" aria-label="Investment">
          <div className="book-strategy-popout-grid">
            <NumberField label="Annual ROI" suffix="%" value={form.annualRoiPercent} onChange={(v) => onFieldChange("annualRoiPercent", v)} disabled={!form.investmentEnabled} />
          </div>
          <p className="drink-note">{drinks.scenario === "halloween" ? "Saved can money grows from day 0; Halloween proceeds grow from day 7." : "Saved can money grows from day 0 until the enhancer purchase."}</p>
        </div> : null}
        {popout === "cans" ? <div className="book-strategy-popout" role="dialog" aria-label="Cans">
          <div className="book-strategy-popout-grid">
            <NumberField label="Faction can bonus" suffix="%" value={drinks.factionPercent} onChange={(v) => updateDrink("factionPercent", v)} title="0–50%; separate from faction gym gains" />
            <label className="book-strategy-field"><span>Company specials</span><select value={drinks.company} onChange={(e) => updateDrink("company", e.target.value as DrinkCompany)}>
              <option value="none">None</option><option value="grocery3">Grocery 3–6★: −10% cooldown</option>
              <option value="grocery7">Grocery 7★+: +10% effect, −10% cooldown</option><option value="restaurant10">Restaurant 10★: −25% cooldown</option>
            </select></label>
            <NumberField label="Maximum booster cooldown" suffix="hours" value={drinks.maxCooldownHours} onChange={(v) => updateDrink("maxCooldownHours", v)} title="24–48 hours, including faction upgrades" />
            <NumberField label="Starting booster cooldown" suffix="hours" value={drinks.startingCooldownHours} onChange={(v) => updateDrink("startingCooldownHours", v)} />
          </div>
          <p className="drink-note">{formatCompact(24 / drinkCooldownHours(drinks.company))} cans per day after the opening burst; {formatCompact(drinkCooldownHours(drinks.company))} hours cooldown each.</p>
        </div> : null}
      </section>
      <section className="panel book-strategy-panel book-strategy-timing-panel">
        <PanelHeader icon={<Sparkles size={17} />} title="Enhancer Timing" />
        <button type="button" className={`book-strategy-mode-button ${earliestOvertakeActive ? "active" : ""}`} onClick={() => onFieldChange("enhancerMode", "earliestOvertake")}>
          {earliestOvertakeActive ? "Earliest overtake" : "Set to earliest overtake"}
        </button>
        <div className="book-strategy-input-grid book-strategy-timing-grid">
          <NumberField label="Use day" value={useDayValue} onChange={(v) => { onFieldChange("enhancerMode", "targetDay"); onFieldChange("enhancerTargetDay", v); }} />
          <NumberField label="Use stat" value={useStatValue} onChange={(v) => { onFieldChange("enhancerMode", "targetStat"); onFieldChange("enhancerTargetStat", v); }} />
        </div>
        <p className="drink-note">{drinks.scenario === "halloween" ? "Both strategies buy all affordable whole enhancers on the same day. Event proceeds are available on day 7; purchases start at day 31. Target stat refers to the saving strategy before enhancers." : "Buy all affordable whole enhancers at one point, then continue normal training. Earliest-overtake results below are calculated separately for each tier."}</p>
        {drinks.scenario === "halloween" ? <p className="drink-note">If no saving overtake is found, automatic mode uses day 31.</p> : null}
      </section>
    </div>

    {invalid ? <p className="panel drink-error" role="alert">{invalid}</p> : null}
    {drinks.scenario === "halloween" ? <HalloweenStrategy inputs={inputs} form={form} drinks={drinks} settings={settings} invalid={invalid} calculation={halloween} onDrinksChange={onDrinksChange} onFieldChange={onFieldChange} /> : <>
    <section className="panel book-strategy-panel" aria-label="Energy drink tier comparison">
      <PanelHeader icon={<BatteryCharging size={17} />} title="Compare all can tiers" />
      <p className="drink-note">Default can prices are based on the annual low point, not live market prices. Enter your purchase price for the can you would use in each tier. Select any tier row to update its graph and stat lead.</p>
      <div className="drink-table-scroll" tabIndex={0} role="region" aria-label="Scrollable can comparison">
        <table className="drink-table"><thead><tr>
          <th scope="col">Can tier</th><th scope="col">Price per can</th><th scope="col">Cans / spend</th><th scope="col">Book energy</th><th scope="col">Extra stats at day 31</th><th scope="col">Stats per $1bn</th><th scope="col">Earliest enhancer overtake</th>
        </tr></thead><tbody>{ENERGY_DRINK_TIERS.map((tier, index) => {
          const row = rows[index];
          const use = row?.strategy.enhancerUse;
          const remaining = use?.investmentBalance != null ? Math.max(0, use.investmentBalance - use.enhancersUsed * inputs.statEnhancerPrice) : null;
          return <tr key={tier.energy} className={index === drinks.selectedTier ? "is-selected" : ""} onClick={() => updateDrink("selectedTier", index)} onFocus={() => updateDrink("selectedTier", index)}>
            <th scope="row"><button className="drink-tier-button" aria-pressed={index === drinks.selectedTier} onClick={() => updateDrink("selectedTier", index)}>{tier.energy}E tier</button><small>{tier.name}</small></th>
            <td><NumberField label={`${tier.energy}E can price`} value={drinks.prices[index]} onChange={(v) => onDrinksChange((current) => ({ ...current, prices: current.prices.map((p, i) => i === index ? v : p) }))} /></td>
            {row ? <>
              <td>{formatCompact(row.plan.totalFhcs)} cans<small>{formatMoney(row.plan.cost)}</small></td>
              <td>{formatCompact(row.plan.energy)}E<small>{row.energyPerCan}E / can</small></td>
              <td>{formatStat(row.strategy.bookEnd.lead)}<small>Book alone: {formatStat(row.bookOnlyGain)}</small></td>
              <td>{row.plan.cost > 0 ? formatStat(row.gainPerBillion) : "—"}</td>
              <td>{use?.day != null ? <>Day {formatCompact(use.day)}<small>{formatStat(use.strategyTwoBeforeEnhancers ?? 0)} stat before enhancers</small><small>{use.enhancersUsed} enhancers · {formatMoney(remaining ?? 0)} left</small></> : <>{row.plan.totalFhcs === 0 ? "No cans purchased" : `Not within ${formatCompact(row.searchDays)} days`}<small>{row.strategy.endpoint.enhancersAffordable} affordable by day {formatCompact(row.inputs.graphDurationDays)}</small></>}</td>
            </> : <td colSpan={5}>{invalid ? "Check inputs above" : "Enter a positive price; projected enhancer purchases must stay below 10,000."}</td>}
          </tr>;
        })}</tbody></table>
      </div>
      {bestValue && mostGain && mostGain.strategy.bookEnd.lead > 0 ? <p className="drink-verdict"><strong>Best value: {bestValue.base}E tier.</strong> Most extra stats at day 31: <strong>{mostGain.base}E tier.</strong> Based on your prices and can settings.</p> : null}
    </section>

    {selected && selectedResult ? <>
      <section className="panel book-strategy-panel" aria-label="Selected can strategy">
        <PanelHeader icon={<TrendingUp size={17} />} title={`${selected.base}E cans vs Enhancers`} />
        <div className="drink-metrics">
          <Metric label="Can budget" value={formatMoney(selected.plan.cost)} detail={`${formatCompact(selected.plan.totalFhcs)} cans`} />
          <Metric label="Extra stats at day 31" value={formatStat(selected.strategy.bookEnd.lead)} detail={`Book alone adds ${formatStat(selected.bookOnlyGain)}`} />
          <Metric label="Enhancers purchased" value={purchase?.day != null ? String(purchase.enhancersUsed) : "None"} detail={purchase?.day != null ? `${formatMoney(purchase.enhancersUsed * selectedResult.inputs.statEnhancerPrice)} spent · Day ${formatCompact(purchase.day)} · ${formatMoney(cashLeft ?? 0)} cash left` : "$0 spent · No purchase in this scenario"} />
          <Metric label={`Stat lead at day ${formatCompact(selectedResult.endpoint.day)}`} value={formatStat(Math.abs(selectedResult.endpoint.difference))} detail={Math.abs(selectedResult.endpoint.difference) < 0.5 ? "Strategies tied" : selectedResult.endpoint.difference > 0 ? "Enhancers ahead" : "Cans ahead"} />
        </div>
        <div className="drink-chart" role="img" aria-label={`Projected stat growth for ${selected.base}E cans versus enhancers`}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={selectedResult.series} margin={{ top: 20, right: 16, bottom: 10, left: 0 }} onClick={(state) => {
            const day = Number(state?.activeLabel);
            if (Number.isFinite(day) && day >= 31) { onFieldChange("enhancerMode", "targetDay"); onFieldChange("enhancerTargetDay", String(Math.round(day))); }
          }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="day" type="number" domain={[0, inputs.graphDurationDays]} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={(v) => formatCompact(v)} />
            <YAxis width={62} domain={["auto", "auto"]} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} tickFormatter={formatStat} />
            <Tooltip formatter={(v: number) => formatStat(v)} labelFormatter={(v) => `Day ${formatCompact(Number(v))}`} contentStyle={{ background: "var(--chart-tooltip-bg)", borderColor: "var(--chart-tooltip-border)", borderRadius: 8 }} />
            <Legend />
            <ReferenceArea x1={0} x2={31} fill="#38bdf8" fillOpacity={0.1} />
            <ReferenceLine x={31} stroke="var(--chart-axis)" strokeDasharray="4 4" label={{ value: "Book ends", fill: "var(--chart-axis)", fontSize: 12 }} />
            {purchase?.day != null && purchase.day <= inputs.graphDurationDays ? <ReferenceLine x={purchase.day} stroke="#f59e0b" strokeDasharray="4 4" /> : null}
            <Line name="Boosted cans" dataKey="strategyOneStat" type="linear" stroke="#38bdf8" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line name="Save for enhancers" dataKey="strategyTwoStat" type="linear" stroke="#f59e0b" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </div>
        <p className="drink-note">Click the graph after day 31 to choose an enhancer-use day. {earliest != null ? `Earliest overtake for this tier: day ${formatCompact(earliest)}.` : `No overtake found within ${formatCompact(selected.searchDays)} days.`}</p>
        {earliest != null && earliest > inputs.graphDurationDays && earliest <= 3650 ? <button className="panel-action-button" onClick={() => onFieldChange("graphDurationDays", String(Math.min(3650, Math.ceil(earliest + 30))))}>Extend graph to overtake</button> : null}
        {purchase?.day != null && purchase.day > inputs.graphDurationDays ? <p className="drink-note">The selected enhancer purchase occurs beyond the displayed graph.</p> : null}
      </section>
      <details className="panel drink-methodology"><summary>Methodology & assumptions</summary>
        <p>Both strategies start with the same stat and normal energy. Only the can strategy drinks during the 31-day book; both then follow the same training rotation. The saving strategy keeps the actual can cost from day zero, with optional annual compound growth.</p>
        <p>Can energy = base energy × faction multiplier × company multiplier × 2, rounded once to the nearest whole energy. No event bonus is assumed. The book does not multiply gym gains.</p>
        <p>Uses available booster cooldown at the start, then drinks as soon as the next full cooldown fits, staying at or below your selected limit. No can is consumed at or after expiry. This assumes timely use, no competing boosters, and training between cans to avoid wasting energy at the energy cap.</p>
        <p>Extra stats compare boosted cans with no cans. “Book alone” compares the same number of cans with and without doubling. Training uses the existing estimated gym formula, constant happiness and 50-energy trains.</p>
        <p>Enhancers are applied as one purchase event after day 31; individual six-hour enhancer cooldowns are not simulated, matching the existing FHC comparison. Whole enhancers compound by 1% each. Cash left after purchase is shown separately and is not converted into stats.</p>
        <p>Each tier compares spending on all cans allowed by the cooldown settings against saving that same amount. Search limits are shown when no enhancer overtake is found; that does not mean it can never happen.</p>
        <p>Mechanics: <a href="https://wiki.torn.com/wiki/Energy_Drink" target="_blank" rel="noreferrer">Torn Wiki energy drinks</a>, <a href="https://wiki.torn.com/wiki/Grocery_Store" target="_blank" rel="noreferrer">Grocery Store</a>, <a href="https://wiki.torn.com/wiki/Restaurant" target="_blank" rel="noreferrer">Restaurant</a>.</p>
      </details>
    </> : null}
    </>}
  </div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="drink-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function validateInputs(inputs: BookStrategyInputs, form: BookStrategyForm, settings: EnergyDrinkSettings): string | null {
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  for (const [key, label, min, max] of [
    ["startingStat", "Starting stat", 1, 1e14], ["happiness", "Happiness", 1, 99999],
    ["gymMultiplier", "Gym dots", 1, 10], ["graphDurationDays", "Graph duration", 31, 3650],
    ["postBookTrainingMonthsOutOfFour", "Months spent training stat", 0, 4],
    ["statEnhancerPrice", "Enhancer price", 1, 1e12], ["startingEnergy", "Starting energy", 0, 1000],
  ] as const) {
    if (!inRange(parseNumber(form[key], NaN), min, max)) return `${label} must be between ${formatCompact(min)} and ${formatCompact(max)}.`;
  }
  if (!inRange(inputs.dailyEnergy, 0, 10000)) return "Normal daily energy must be between 0 and 10,000.";
  if (!inRange(settings.factionPercent, 0, 50)) return "Faction can bonus must be between 0% and 50%.";
  if (!inRange(settings.maxCooldownHours, 24, 48)) return "Maximum booster cooldown must be between 24 and 48 hours.";
  if (!inRange(settings.startingCooldownHours, 0, settings.maxCooldownHours)) return "Starting booster cooldown must be between zero and your maximum.";
  if (form.investmentEnabled && !inRange(parseNumber(form.annualRoiPercent, NaN), 0, 100)) return "Annual ROI must be between 0% and 100%.";
  if (form.enhancerMode === "targetDay" && !inRange(parseNumber(form.enhancerTargetDay, NaN), 31, 20000)) return "Enhancer use day must be between 31 and 20,000.";
  if (form.enhancerMode === "targetStat" && !inRange(parseNumber(form.enhancerTargetStat, NaN), 1, 1e14)) return "Enter a positive target stat up to 100 trillion.";
  return null;
}
