import React from "react";
import { Activity, BadgeDollarSign, RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { CollapsiblePanel, PanelHeader } from "../components/Common";
import { NumberField, PerkInputs, PopoutButton, type TrainingPerkSettings } from "../components/TrainingCalculatorInputs";
import { StatEnhancerRangeChart } from "../components/StatEnhancerRangeChart";
import { defaultBookStrategyInputs } from "../utils/bookStrategy";
import {
  compareEnhancerEfficiency, findEnhancerBreakEvenStat, MAX_RANGE_STAT, type StatEnhancerSettings,
} from "../utils/statEnhancerRange";
import { formatCompact, formatMoney, parseNumber } from "./BookStrategy.helpers";
import "./StatEnhancerRange.css";

type Form = Record<keyof StatEnhancerSettings | "currentStat" | "cashPerEnergy", string>;
const defaults = defaultBookStrategyInputs;
const DEFAULT_FORM: Form = {
  currentStat: String(defaults.startingStat),
  cashPerEnergy: "100000",
  happiness: String(defaults.happiness),
  gymMultiplier: String(defaults.gymMultiplier),
  statEnhancerPrice: String(defaults.statEnhancerPrice),
  privateIslandPercent: String(defaults.privateIslandPercent),
  generalEducationPercent: String(defaults.generalEducationPercent),
  statEducationPercent: String(defaults.statEducationPercent),
  steadfastPercent: String(defaults.steadfastPercent),
  customPerksPercent: String(defaults.customPerksPercent),
};

const FIELDS: Record<keyof Form, { label: string; min: number; max: number }> = {
  currentStat: { label: "Current stat", min: 1, max: MAX_RANGE_STAT },
  cashPerEnergy: { label: "Cash earned per energy", min: 0, max: 1e9 },
  happiness: { label: "Happiness", min: 1, max: 10_000 },
  gymMultiplier: { label: "Gym dots", min: 1, max: 10 },
  statEnhancerPrice: { label: "Enhancer price", min: 1, max: 1e12 },
  privateIslandPercent: { label: "Property perk", min: 0, max: 1000 },
  generalEducationPercent: { label: "General education perk", min: 0, max: 1000 },
  statEducationPercent: { label: "Stat education perk", min: 0, max: 1000 },
  steadfastPercent: { label: "Faction Steadfast", min: 0, max: 1000 },
  customPerksPercent: { label: "Job perks", min: 0, max: 1000 },
};

export function StatEnhancerRange() {
  const [form, setForm] = React.useState<Form>(DEFAULT_FORM);
  const [popout, setPopout] = React.useState<"perks" | "prices" | null>(null);
  const [methodologyOpen, setMethodologyOpen] = React.useState(false);
  const [chartVersion, setChartVersion] = React.useState(0);
  const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, parseNumber(value, NaN)])) as
    StatEnhancerSettings & { currentStat: number; cashPerEnergy: number };
  const errors = (Object.keys(FIELDS) as Array<keyof Form>).flatMap((key) => {
    const { label, min, max } = FIELDS[key];
    return !Number.isFinite(values[key]) || values[key] < min || values[key] > max
      ? [`${label}: enter a number from ${formatCompact(min)} to ${formatCompact(max)}.`] : [];
  });
  const valid = errors.length === 0;
  const result = valid ? compareEnhancerEfficiency(values.currentStat, values.cashPerEnergy, values) : null;
  const breakEvenStat = valid ? findEnhancerBreakEvenStat(values.cashPerEnergy, values) : null;

  function updateField(key: keyof Form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePoint(stat: number, cashPerEnergy: number) {
    setForm((current) => ({ ...current, currentStat: String(Math.round(stat)), cashPerEnergy: String(Math.round(cashPerEnergy)) }));
  }

  function updatePerk(field: keyof TrainingPerkSettings, value: string) {
    updateField(field, value);
  }

  return (
    <>
      <section className="hero-panel compact-hero-panel book-strategy-hero">
        <div>
          <p className="eyebrow">Calculator</p>
          <h2>Stat Enhancer Range</h2>
          <p>Find where earning cash for stat enhancers gives more stats per energy than gym training.</p>
        </div>
        <button type="button" className="panel-action-button" onClick={() => { setForm(DEFAULT_FORM); setPopout(null); setChartVersion((current) => current + 1); }}>
          <RotateCcw size={15} /> Reset
        </button>
      </section>

      <div className="book-strategy-layout se-range-layout">
        <section className="panel book-strategy-panel book-strategy-input-panel" onKeyDown={(event) => {
          if (event.key === "Escape") setPopout(null);
        }}>
          <PanelHeader icon={<SlidersHorizontal size={17} />} title="Inputs" control={
            <div className="book-strategy-popout-actions">
              <PopoutButton icon={<Sparkles size={15} />} label="Perks" active={popout === "perks"}
                onClick={() => setPopout((current) => current === "perks" ? null : "perks")} />
              <PopoutButton icon={<BadgeDollarSign size={15} />} label="Prices" active={popout === "prices"}
                onClick={() => setPopout((current) => current === "prices" ? null : "prices")} />
            </div>
          } />
          <div className="book-strategy-input-grid se-range-inputs">
            <NumberField label="Current stat" value={form.currentStat} onChange={(value) => updateField("currentStat", value)} />
            <NumberField label="Cash earned per energy" value={form.cashPerEnergy} onChange={(value) => updateField("cashPerEnergy", value)} />
            <NumberField label="Gym dots" value={form.gymMultiplier} onChange={(value) => updateField("gymMultiplier", value)} title="Capped range: 1–10 gym dots" />
            <NumberField label="Happiness" value={form.happiness} onChange={(value) => updateField("happiness", value)} />
          </div>
          <p className="se-range-note">Accepts values like 500m and 100k. Use cash available for enhancers after activity costs.</p>
          {popout === "perks" ? <PerkInputs settings={form} onSettingChange={updatePerk} /> : null}
          {popout === "prices" ? (
            <div className="book-strategy-popout" role="dialog" aria-label="Prices">
              <NumberField label="Enhancer price" value={form.statEnhancerPrice} onChange={(value) => updateField("statEnhancerPrice", value)} />
            </div>
          ) : null}
          {errors.length > 0 ? <div className="se-range-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
        </section>

        {result ? (
          <>
            <section className="panel se-range-chart-panel">
              <PanelHeader icon={<Activity size={17} />} title="Explore SE range" aside={`Enhancer price: ${formatMoney(values.statEnhancerPrice)}`} />
              <div className="se-range-legend">
                <span><i className="se-legend-enhancer" /> SE range · enhancers win</span>
                <span><i className="se-legend-gym" /> Gym training wins</span>
                <span><i className="se-legend-boundary" /> Break-even curve</span>
                <span><i className="se-legend-marker" /> Your position</span>
              </div>
              <StatEnhancerRangeChart key={chartVersion} stat={values.currentStat} cashPerEnergy={values.cashPerEnergy} settings={values} onSelect={updatePoint} />
              <p className="se-range-note">Click or drag in the graph to move your marker. Use arrow keys when the graph is focused. The stat axis uses a logarithmic scale.</p>
            </section>

            <section className="panel se-range-summary" aria-label="Efficiency comparison">
              <div className={`se-range-outcome is-${result.winner}`} role="status">
                <strong>{result.winner === "equal" ? "At break-even" : result.winner === "enhancer" ? "You are in SE range" : "Gym training is more efficient"}</strong>
                <span>{efficiencyDescription(result)}</span>
              </div>
              <div className="se-range-metrics">
                <ResultMetric label="Gym stats per energy" value={formatCompact(result.gym)} />
                <ResultMetric label="Enhancer stats per energy" value={formatCompact(result.enhancer)} />
                <ResultMetric label="Break-even stat" value={breakEvenStat === null ? (values.cashPerEnergy === 0 ? "No crossover" : `Above ${formatCompact(MAX_RANGE_STAT)}`) : formatCompact(breakEvenStat)}
                  detail={`At ${formatMoney(values.cashPerEnergy)} per energy`} />
                <ResultMetric label="Cash per energy to break even" value={formatMoney(result.requiredCashPerEnergy)}
                  detail={`At your current ${formatCompact(values.currentStat)} stat`} />
              </div>
            </section>
          </>
        ) : <section className="panel se-range-empty">Enter valid inputs to display the SE range graph and comparison.</section>}

        <CollapsiblePanel title="How this is calculated" collapsed={!methodologyOpen} onToggle={() => setMethodologyOpen((current) => !current)}>
          <div className="book-strategy-methodology">
            <p>Gym gains use the same estimated training formula and multiplicative perks as Book Strategy, with your selected gym dots and constant happiness. No book bonus is applied.</p>
            <p>Enhancer stats per energy = current stat × 1% × cash earned per energy ÷ enhancer price.</p>
            <p>The curve marks equal efficiency. Above it, cash earned with the same energy buys more stat gain through enhancers. Below it, gym training gives more.</p>
            <p>This compares efficiency at the entered stat, treating enhancer purchases proportionally. It does not project saving, whole-item purchases, cooldowns, or future growth. Prices and earnings are your inputs.</p>
          </div>
        </CollapsiblePanel>
      </div>
    </>
  );
}

export function efficiencyDescription(result: ReturnType<typeof compareEnhancerEfficiency>): string {
  if (result.winner === "equal") return "Both methods give the same stats per energy.";
  if (result.advantagePercent === null) return "Zero earnings provide no enhancer gains.";
  const percent = result.advantagePercent < 0.1 ? "Less than 0.1%" : `${formatCompact(result.advantagePercent)}%`;
  return `${percent} more stats per energy with ${result.winner === "enhancer" ? "enhancers" : "gym training"}.`;
}

function ResultMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="se-range-metric"><span>{label}</span><strong>{value}</strong>{detail ? <small>{detail}</small> : null}</div>;
}
