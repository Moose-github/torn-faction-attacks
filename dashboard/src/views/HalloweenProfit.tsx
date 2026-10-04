import React from "react";
import { Ghost, RotateCcw, Settings2, X, Trophy, TrendingDown, Wallet, Swords } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard, PanelHeader } from "../components/Common";
import { NumberField, PopoutButton } from "../components/TrainingCalculatorInputs";
import { getHalloweenPrices, type HalloweenPriceSnapshot } from "../api/halloweenPrices";
import { ENERGY_DRINK_TIERS } from "../utils/energyDrinkStrategy";
import { DEFAULT_HALLOWEEN, HALLOWEEN_BOOKS, HALLOWEEN_BOOSTERS,
  HALLOWEEN_COMPANIES, HALLOWEEN_BASKETS, HALLOWEEN_SIMULATION_RUNS, HALLOWEEN_REFINED_RUNS, validateHalloween, getSimulatedTreatsPerAttack,
  type HalloweenBook, type HalloweenSettings, type HalloweenResult } from "../utils/halloweenProfit";
import { formatMoney, formatCompact } from "./BookStrategy.helpers";
import "./HalloweenProfit.css";
import { HalloweenStrategyBreakdown } from "./HalloweenStrategyBreakdown";
import { HalloweenDistributions } from "./HalloweenDistributions";
import type { HalloweenWorkerRequest, HalloweenWorkerResponse } from "../workers/halloweenProfitWorker";

type NumericKey = Exclude<{ [K in keyof HalloweenSettings]: HalloweenSettings[K] extends number ? K : never }[keyof HalloweenSettings], "drugInterval">;
const numberKeys = Object.keys(DEFAULT_HALLOWEEN).filter(key => key !== "drugInterval" && typeof DEFAULT_HALLOWEEN[key as keyof HalloweenSettings] === "number") as NumericKey[];
const initialNumbers = () => Object.fromEntries(numberKeys.map(key => [key, String(DEFAULT_HALLOWEEN[key])])) as Record<NumericKey, string>;
const parse = (value: string) => {
  const match = value.replace(/[$,\s]/g, "").match(/^(-?\d+(?:\.\d+)?|\.\d+)([kmb])?$/i);
  return match ? Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1) : NaN;
};
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const bookName = (book: HalloweenBook) => HALLOWEEN_BOOKS.find(item => item.id === book)!.name;
const boosterName = (id: string) => HALLOWEEN_BOOSTERS.find(item => item.id === id)!.name;
const strategyName = (row: HalloweenResult) => `${bookName(row.book)} · ${boosterName(row.booster)}`;
const profitRange = (row: HalloweenResult) => `${formatMoney(row.profitRange.low)} to ${formatMoney(row.profitRange.high)}`;

function BaselineDifference({ value, baseline, money = false }: { value: number; baseline: number; money?: boolean }) {
  const difference = Math.round((value - baseline) * 10) / 10;
  const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
  return <small title="Difference from no book and no paid boosters">
    {sign}{money ? formatMoney(Math.abs(difference)) : count(Math.abs(difference))}
  </small>;
}

export function HalloweenProfit() {
  const [options, setOptions] = React.useState(DEFAULT_HALLOWEEN);
  const [numbers, setNumbers] = React.useState(initialNumbers);
  const [xanaxPerDay, setXanaxPerDay] = React.useState(String(24 / DEFAULT_HALLOWEEN.drugInterval));
  const [prices, setPrices] = React.useState<string[]>(ENERGY_DRINK_TIERS.map(tier => tier.price));
  const [books, setBooks] = React.useState<HalloweenBook[]>(HALLOWEEN_BOOKS.map(book => book.id));
  const [popout, setPopout] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [outcomesOpen, setOutcomesOpen] = React.useState(false);
  const [sort, setSort] = React.useState("highest");
  const [loadingPrices, setLoadingPrices] = React.useState(false);
  const [priceError, setPriceError] = React.useState<string | null>(null);
  const [priceSnapshot, setPriceSnapshot] = React.useState<HalloweenPriceSnapshot | null>(null);
  const [priceNotice, setPriceNotice] = React.useState<string | null>(null);
  const priceRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => priceRequest.current?.abort(), []);
  const resetPrices = () => {
    priceRequest.current?.abort(); priceRequest.current = null;
    setLoadingPrices(false); setPriceError(null); setPriceSnapshot(null);
    setPrices(ENERGY_DRINK_TIERS.map(tier => tier.price));
    setNumbers(current => ({ ...current, fhcPrice: String(DEFAULT_HALLOWEEN.fhcPrice) }));
    setPriceNotice("FHC and can prices reset to the default annual lows.");
  };
  const useWeav3rPrices = async () => {
    priceRequest.current?.abort();
    const controller = new AbortController(); priceRequest.current = controller;
    setLoadingPrices(true); setPriceError(null); setPriceNotice(null);
    try {
      const snapshot = await getHalloweenPrices(controller.signal);
      if (controller.signal.aborted) return;
      setPrices(ENERGY_DRINK_TIERS.map(tier => String(snapshot.cans.find(can => can.energy === tier.energy)!.price)));
      setNumbers(current => ({ ...current, fhcPrice: String(snapshot.fhc.price) }));
      setPriceSnapshot(snapshot);
    } catch (error) {
      if (!controller.signal.aborted) setPriceError(`${error instanceof Error ? error.message : "Unable to load Weav3r prices."} Your prices have not been changed.`);
    } finally {
      if (priceRequest.current === controller) { priceRequest.current = null; setLoadingPrices(false); }
    }
  };
  const clearPriceSource = () => { setPriceSnapshot(null); setPriceNotice(null); setPriceError(null); };
  const panel = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!popout) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPopout(null); };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setPopout(null); };
    window.addEventListener("keydown", close); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", outside); };
  }, [popout]);
  const dailyXanax = parse(xanaxPerDay);
  const basket = HALLOWEEN_BASKETS.find(item => item.id === options.basketLevel)!;
  const settings = React.useMemo(() => ({ ...options,
    ...Object.fromEntries(numberKeys.map(key => [key, parse(numbers[key])])), canPrices: prices.map(parse),
    drugInterval: 24 / dailyXanax,
  }) as HalloweenSettings, [options, numbers, prices, dailyXanax]);
  const validationError = !Number.isFinite(dailyXanax) || dailyXanax < 1 || dailyXanax > 4
    ? "Enter Xanax/day between 1 and 4." : validateHalloween(settings);
  const [calculation, setCalculation] = React.useState<{
    settings: HalloweenSettings; results: HalloweenResult[]; error: string | null;
  } | null>(null);
  const [refinement, setRefinement] = React.useState<{ settings: HalloweenSettings } | null>(null);
  const requestedRuns = refinement?.settings === settings ? HALLOWEEN_REFINED_RUNS : HALLOWEEN_SIMULATION_RUNS;
  const [job, setJob] = React.useState<{
    settings: HalloweenSettings; runs: number; completed: number; total: number; error: string | null;
  } | null>(null);
  React.useEffect(() => {
    if (validationError) return;
    let cancelled = false;
    const total = HALLOWEEN_BOOKS.length * HALLOWEEN_BOOSTERS.length;
    setJob({ settings, runs: requestedRuns, completed: 0, total, error: null });
    const finish = (results: HalloweenResult[], error: string | null) => {
      if (cancelled) return;
      // A failed refinement must not discard the current 128-run comparison.
      if (!error || requestedRuns === HALLOWEEN_SIMULATION_RUNS) setCalculation({ settings, results, error });
      setJob({ settings, runs: requestedRuns, completed: total, total, error });
    };
    const worker = new Worker(new URL("../workers/halloweenProfitWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<HalloweenWorkerResponse>) => {
      if (cancelled) return;
      if (event.data.type === "progress") {
        setJob({ settings, runs: requestedRuns, completed: event.data.completed, total: event.data.total, error: null });
      } else {
        finish(event.data.results, event.data.error);
        worker.terminate();
      }
    };
    worker.onerror = () => { finish([], "Unable to calculate Halloween strategies. Try again or change an input."); worker.terminate(); };
    worker.postMessage({ settings, runs: requestedRuns } satisfies HalloweenWorkerRequest);
    return () => { cancelled = true; worker.terminate(); };
  }, [settings, validationError, requestedRuns, refinement]);
  const currentCalculation = calculation?.settings === settings ? calculation : null;
  const error = validationError ?? currentCalculation?.error;
  const results = error ? [] : currentCalculation?.results ?? [];
  const displayedRuns = results[0]?.simulationRuns ?? HALLOWEEN_SIMULATION_RUNS;
  const currentJob = job?.settings === settings && job.runs === requestedRuns ? job : null;
  const refinementError = requestedRuns === HALLOWEEN_REFINED_RUNS ? currentJob?.error : null;
  const refining = requestedRuns === HALLOWEEN_REFINED_RUNS && displayedRuns !== HALLOWEEN_REFINED_RUNS && !refinementError;
  const ranked = results.filter(row => books.includes(row.book)).sort((a, b) => b.profit - a.profit);
  const rows = sort === "lowest" ? [...ranked].reverse() : ranked;
  const best = ranked[0];
  const bestWithoutBook = ranked.find(row => row.book === "none");
  const baseline = results.find(row => row.id === "none:none");
  const selected = ranked.find(row => row.id === selectedId) ?? best;
  const energyLosses = selected ? [
    { label: "regeneration lost", energy: selected.wastedRegeneration },
    { label: "Dark Power lost to the cap", energy: selected.wastedDarkEnergy },
    { label: "other energy lost to the cap", energy: selected.wastedClaimEnergy },
    { label: "left after the event", energy: selected.unusedEnergy },
  ].filter(row => Math.round(row.energy * 10) > 0) : [];
  const selectedNoBooster = results.find(row => row.book === selected?.book && row.booster === "none");
  const selectedNoBook = results.find(row => row.book === "none" && row.booster === selected?.booster);
  const [alternative, setAlternative] = React.useState<{
    settings: HalloweenSettings; id: string; runs: number; result: HalloweenResult;
  } | null>(null);
  const selectedBook = selected?.book, selectedBooster = selected?.booster;
  React.useEffect(() => {
    if (!selectedBook || !selectedBooster || error) return;
    let cancelled = false;
    const worker = new Worker(new URL("../workers/halloweenProfitWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<HalloweenWorkerResponse>) => {
      if (event.data.type !== "result") return;
      if (!cancelled && !event.data.error && event.data.results[0]) {
        setAlternative({ settings, id: `${selectedBook}:${selectedBooster}`, runs: displayedRuns, result: event.data.results[0] });
      }
      worker.terminate();
    };
    worker.onerror = () => worker.terminate();
    worker.postMessage({ settings: { ...settings, weapon: settings.weapon === "scary" ? "revitalize" : "scary" },
      runs: displayedRuns, strategy: { book: selectedBook, booster: selectedBooster } } satisfies HalloweenWorkerRequest);
    return () => { cancelled = true; worker.terminate(); };
  }, [settings, selectedBook, selectedBooster, displayedRuns, error]);
  const alternativeWeapon = alternative?.settings === settings && alternative.id === selected?.id && alternative.runs === displayedRuns
    ? alternative.result : null;
  const chart = selected?.timeline.map((point, index) => ({ ...point, baseline: baseline?.timeline[index].profit }));
  const change = <K extends keyof HalloweenSettings>(key: K, value: HalloweenSettings[K]) => setOptions(current => ({ ...current, [key]: value }));
  const field = (key: NumericKey, label: string, suffix?: string, title?: string, disabled = false) =>
    <NumberField key={key} label={label} value={numbers[key]} suffix={suffix} title={title} disabled={disabled}
      onChange={value => { if (key === "fhcPrice") clearPriceSource(); setNumbers(current => ({ ...current, [key]: value })); }} />;
  const toggle = (key: "donor" | "scaryClothing" | "mortalCoil" | "darkPower" | "freebie" | "cashback", label: string) =>
    <label className="halloween-toggle"><input type="checkbox" checked={options[key]} onChange={event => change(key, event.target.checked)} />{label}</label>;
  const reset = () => { resetPrices(); setPriceNotice(null); setOptions(DEFAULT_HALLOWEEN); setNumbers(initialNumbers());
    setXanaxPerDay(String(24 / DEFAULT_HALLOWEEN.drugInterval));
    setBooks(HALLOWEEN_BOOKS.map(b => b.id)); setSelectedId(null); setPopout(null); setSort("highest"); };
  const bonusProfit = selected && selectedNoBooster ? selected.profit - selectedNoBooster.profit : 0;
  const boosterSpend = selected?.sources.find(source => source.name === boosterName(selected.booster))?.cost ?? 0;
  const breakEvenBooster = selected?.boosterCount ? (bonusProfit + boosterSpend) / selected.boosterCount : null;

  return <div className="halloween-profit">
    <section className="panel halloween-heading">
      <div><div className="panel-kicker"><Ghost size={18} /> Halloween calculator</div><h1>Halloween profit</h1>
        <p>Find the books and boosters that make your seven days of attacking most profitable.</p></div>
      <button type="button" className="book-strategy-popout-button" onClick={reset}><RotateCcw size={15} />Reset</button>
      <div className="halloween-assumptions"><span className="halloween-upgrades-assumption">{options.mortalCoil && options.darkPower && options.freebie && options.cashback ? "All basket upgrades purchased" : "All other basket upgrades purchased"}</span><span>100% attack success</span><span>All energy used for attacks</span><span>Full 7-day book overlap</span></div>
    </section>

    <section className="panel book-strategy-input-panel halloween-settings" ref={panel}>
      <PanelHeader title="Event & prices" icon={<Settings2 size={18} />} />
      <div className="halloween-fields">
        {field("treatPrice", "Price per treat", "$", "Reward value with Freebie enabled. Disabling Freebie uses this value divided by 1.1. Editable planning estimate; not a live market quote.")}
        <label className="book-strategy-field"><span>Basket level</span><select value={options.basketLevel} onChange={event => change("basketLevel", event.target.value as HalloweenSettings["basketLevel"])}>
          {HALLOWEEN_BASKETS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="book-strategy-field"><span>Finishing weapon</span><select value={options.weapon} onChange={event => change("weapon", event.target.value as HalloweenSettings["weapon"])}>
          <option value="scary">Scary weapon</option><option value="revitalize">Revitalize weapon</option></select></label>
        {options.weapon === "revitalize" ? field("revitalize", "Revitalize chance", "%") : <div className="halloween-inline-note">Scary finish adds 10 percentage points to your treat chance.</div>}
      </div>
      <div className="halloween-controls">{["Energy & drugs", "Boosters", "Prices", "Company", "Upgrades"].map(label =>
        <PopoutButton key={label} label={label} icon={<Settings2 size={14} />} active={popout === label} onClick={() => setPopout(popout === label ? null : label)} />)}</div>
      {popout && <div className="book-strategy-popout halloween-popout" role="region" aria-label={popout}>
        <div className="halloween-popout-title"><strong>{popout}</strong><button type="button" aria-label="Close settings" onClick={() => setPopout(null)}><X size={18} /></button></div>
        <div className="book-strategy-popout-grid">
          {popout === "Upgrades" && <>
            {toggle("scaryClothing", "Wear scary clothing")}
            {toggle("mortalCoil", "Mortal Coil")}
            {toggle("darkPower", "Dark Power")}
            {toggle("freebie", "Freebie")}
            {toggle("cashback", "Cashback")}
            <p className="halloween-wide">Mortal Coil adds one treat per hour. Dark Power returns 5E per treat exchanged. Freebie adds one bonus exchange for every 10 treats, rounded down. Cashback returns 10% of the original batch, rounded down before Freebie is added.</p>
            <p className="halloween-wide">Price per treat assumes Freebie is enabled. Turning it off divides the reward value by 1.1; your entered price is preserved. All other basket upgrades remain assumed purchased; Cat in Hell and Inflation are excluded.</p>
          </>}
          {popout === "Energy & drugs" && <>
            {toggle("donor", "Donator regeneration")}
            <p className="halloween-wide">Daily energy refills are used every day. Max natural energy use is assumed.</p>
            {field("startingEnergy", "Starting energy", "E", "Energy already stacked when the event begins. Its cost is excluded from the comparison.")}
            {field("specialRefills", "Special energy refills", "refills", "Free refills, prioritised at 0E; maximum 100.")}
            {field("extraEnergy", "Other one-off energy", "E", "One claim at the first active moment, after spending stored energy. Use for stock or newsletter energy; any energy above the 1,000E cap is lost.")}
            {field("greenEggs", "Available Green Easter eggs", "eggs", "500E and 6h cooldown each. Used before paid boosters; also included in the baseline. Eggs are valued at $0.")}
            {field("drugPrice", "Price per Xanax", "$")}
            <NumberField label="Xanax/day" value={xanaxPerDay} onChange={setXanaxPerDay} title="Average daily use, spaced evenly over 24 hours. Enter 1 to 4; decimals are allowed. Starting drug cooldown still applies. No overdoses are simulated." />
            {field("drugDelay", "Starting drug cooldown", "hours")}
          </>}
          {popout === "Boosters" && <>
            {field("factionBonus", "Faction can bonus", "%")}
            {field("maxCooldown", "Maximum booster cooldown", "hours")}
            {field("startingCooldown", "Starting booster cooldown", "hours")}
          </>}
          {popout === "Prices" && <>
            <div className="halloween-wide halloween-price-actions">
              <button type="button" className="book-strategy-popout-button" disabled={loadingPrices} onClick={useWeav3rPrices}>{loadingPrices ? "Loading Weav3r prices…" : "Use Weav3r prices"}</button>
              <button type="button" className="book-strategy-popout-button" onClick={resetPrices}><RotateCcw size={14} />Reset to annual lows</button>
            </div>
            <p className="halloween-wide">Applies to FHCs and all six can tiers. Uses Weav3r's reported market prices and the cheaper can where a tier has two variants. Prices can be edited after loading.</p>
            {priceError && <p className="halloween-wide halloween-error" role="alert">{priceError}</p>}
            {priceSnapshot && <p className="halloween-wide" role="status">Weav3r prices applied. Oldest snapshot: {new Date(priceSnapshot.generatedAt * 1000).toLocaleString()}. Market values may lag current listings.</p>}
            {priceNotice && <p className="halloween-wide" role="status">{priceNotice}</p>}
            {field("fhcPrice", "Price per FHC", "$", undefined, loadingPrices)}
            {ENERGY_DRINK_TIERS.map((tier, index) => <NumberField key={tier.energy} label={`${tier.energy}E can price`} title={tier.name} suffix="$" value={prices[index]}
              disabled={loadingPrices} onChange={value => { clearPriceSource(); setPrices(current => current.map((price, i) => i === index ? value : price)); }} />)}
            <p className="halloween-wide">Default can prices are based on the annual low point, not live market prices. Enter your own purchase prices. Owned boosters still have a cost.</p>
          </>}
          {popout === "Company" && <>
            <label className="book-strategy-field halloween-wide"><span>Company specials</span><select value={options.company} onChange={event => change("company", event.target.value as HalloweenSettings["company"])}>
              {HALLOWEEN_COMPANIES.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
            {field("jobPoints", "Banked job points", "JP", "Redeem up to 100 per calendar day.", !HALLOWEEN_COMPANIES.find(c => c.id === options.company)?.energy)}
            {field("dailyJobPoints", "Job points earned daily", "JP", "Added at 18:00 TCT.", !HALLOWEEN_COMPANIES.find(c => c.id === options.company)?.energy)}
            <p className="halloween-wide">Grocery: −10% can cooldown, plus +10% can energy at 7★. Restaurant: −25% can cooldown and 3E/JP. Farm: 7E/JP. Candle / Game shop: 5E/JP. Company benefits apply only to the selected company.</p>
          </>}
        </div>
      </div>}
      <p className="halloween-note">Price per treat is a flat valuation of exchanged rewards. The $750,000 default is a planning estimate; changing it updates every strategy.</p>
      {selected && !settings.freebie && <p className="halloween-note">Freebie is disabled: rewards use ${selected.effectiveTreatPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} per treat (your entered price ÷ 1.1). The break-even price is quoted in the same units as the price input, with Freebie included.</p>}
      <p className="halloween-note"><strong>Default item prices are based on the annual low for each item, not live market prices.</strong></p>
    </section>

    <section className="panel"><PanelHeader title="Books to compare" aside="One book at a time" />
      <div className="halloween-books">{HALLOWEEN_BOOKS.map(book => <label key={book.id} className={books.includes(book.id) ? "selected" : ""}>
        <input type="checkbox" checked={books.includes(book.id)} disabled={book.id === "none"} onChange={event => setBooks(current => event.target.checked ? [...current, book.id] : current.filter(id => id !== book.id))} />
        <span><strong>{book.name}</strong><small>{book.description}</small></span></label>)}</div>
    </section>
    {!error && !currentCalculation && <section className="panel" role="status">Calculating strategies across {HALLOWEEN_SIMULATION_RUNS} simulations…</section>}
    {error ? <section className="panel halloween-error" role="alert">{error}</section> : best && bestWithoutBook && baseline && selected && <>
      <div className="halloween-metrics">
        <MetricCard label="Highest net profit" value={formatMoney(best.profit)} detail={strategyName(best)} icon={<Trophy size={16} />} />
        <MetricCard label="Best uplift over baseline" value={formatMoney(best.profit - baseline.profit)} detail="Compared with no book and no paid boosters" icon={<Wallet size={16} />} />
        <MetricCard label="Best without a book" value={formatMoney(bestWithoutBook.profit)} detail={boosterName(bestWithoutBook.booster)} icon={<Wallet size={16} />} />
        <MetricCard label="Baseline net profit" value={formatMoney(baseline.profit)} detail="Same weapon, company, drugs, refills and free energy" icon={<Swords size={16} />} />
      </div>
      <section className="panel"><PanelHeader title="Strategy comparison" control={<div className="halloween-comparison-controls">
        <button type="button" className="book-strategy-popout-button" disabled={refining || displayedRuns === HALLOWEEN_REFINED_RUNS}
          onClick={() => setRefinement({ settings })} title="Recalculate all strategies with 1,024 simulations for a more precise estimate. Changing an input returns to 128 runs.">
          {refining ? "Refining…" : displayedRuns === HALLOWEEN_REFINED_RUNS ? "Refined · 1,024 runs" : "Refine estimate"}
        </button>
        <label className="halloween-sort">Sort <select value={sort} onChange={event => setSort(event.target.value)}><option value="highest">Highest profit first</option><option value="lowest">Lowest profit first</option></select></label>
      </div>} />
        {refining && <p className="halloween-note" role="status">Refining all strategies to 1,024 simulations · {currentJob?.completed ?? 0} / {currentJob?.total ?? 40} complete. Showing the current 128-run estimates until finished.</p>}
        {refinementError && <p className="halloween-error" role="alert">Refinement failed. Your 128-run estimates are still shown. {refinementError}</p>}
        <p className="halloween-note">{ranked.length} strategies · Select a row to inspect its profit and energy breakdown. Smaller figures show the difference from no book and no paid boosters, with the same weapon and energy settings. Figures average {displayedRuns.toLocaleString()} repeatable simulations with whole attacks, random whole-treat drops and Revitalize rolls where applicable.</p>
        <p className="halloween-note">Net profit shows the average and a likely range covering the middle 80% of simulated outcomes. Strategies are ranked by average profit.</p>
        <div className="halloween-table-scroll"><table className="halloween-table"><thead><tr><th>Book / booster</th><th>Boosters</th><th>Attacks</th><th>Treats exchanged</th><th>Reward value</th><th>Total spent</th><th>Average net profit</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.id === selected.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}>
            <td><button type="button" aria-pressed={row.id === selected.id} onClick={() => setSelectedId(row.id)}>{bookName(row.book)}<small>{boosterName(row.booster)}</small></button></td>
            <td>{row.boosterCount || "—"}<BaselineDifference value={row.boosterCount} baseline={baseline.boosterCount} /></td>
            <td>{count(row.attacks)}<BaselineDifference value={row.attacks} baseline={baseline.attacks} /></td>
            <td>{count(row.exchangedTreats)}<BaselineDifference value={row.exchangedTreats} baseline={baseline.exchangedTreats} /></td>
            <td>{formatMoney(row.revenue)}<BaselineDifference value={row.revenue} baseline={baseline.revenue} money /></td>
            <td>{formatMoney(row.cost)}<BaselineDifference value={row.cost} baseline={baseline.cost} money /></td>
            <td className={row.profit >= 0 ? "halloween-positive" : "halloween-negative"}>{formatMoney(row.profit)}<small className="halloween-profit-range" title="10th–90th percentiles of simulated net profit; reflects treat-drop and Revitalize luck only.">Likely range {profitRange(row)}</small><BaselineDifference value={row.profit} baseline={baseline.profit} money /></td>
          </tr>)}</tbody></table></div>
      </section>
      <HalloweenDistributions settings={settings} selected={selected} strategyName={strategyName(selected)} open={outcomesOpen} onOpenChange={setOutcomesOpen} />
      <section className="panel halloween-detail"><PanelHeader title={strategyName(selected)} aside="Selected strategy" />
        <div className="halloween-metrics">
          <MetricCard label="Average net profit" value={formatMoney(selected.profit)} detail={`Likely range (80%): ${profitRange(selected)}`} icon={<Wallet size={16} />} />
          <MetricCard label="Extra profit from boosters" value={formatMoney(bonusProfit)} detail="Versus the same book without paid boosters" icon={<TrendingDown size={16} />} />
          <MetricCard label="Extra profit from book" value={formatMoney(selected.profit - (selectedNoBook?.profit ?? 0))} detail="Versus the same booster without a book" icon={<Trophy size={16} />} />
          <MetricCard label="Break-even price per treat" value={formatMoney(selected.breakEvenTreatPrice)} detail={selected.roi === null ? "No monetary spend" : `${count(selected.roi * 100)}% return on total spend`} icon={<Wallet size={16} />} />
        </div>
        <div className="halloween-chart" aria-label="Cumulative event profit compared with baseline">
          <ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 15, right: 18, bottom: 5, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" /><XAxis dataKey="hour" type="number" domain={[0,168]} ticks={[0,24,48,72,96,120,144,168]} tickFormatter={hour => `${hour}h`} stroke="var(--chart-axis)" /><YAxis tickFormatter={formatCompact} stroke="var(--chart-axis)" width={68} />
            <Tooltip formatter={(value: number) => formatMoney(value)} labelFormatter={hour => `Hour ${hour}`} contentStyle={{ background: "var(--chart-tooltip-bg)", borderColor: "var(--chart-tooltip-border)", borderRadius: 8 }} />
            <Legend /><Line name="Selected strategy" dataKey="profit" stroke="#fb923c" dot={false} strokeWidth={2} isAnimationActive={false} /><Line name="No-book / no-paid-booster baseline" dataKey="baseline" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart></ResponsiveContainer>
        </div>
        <div className="halloween-breakdowns">
          <div><h3>Energy & costs</h3><div className="halloween-table-scroll"><table className="halloween-table"><thead><tr><th>Source</th><th>Energy</th><th>Count</th><th>Cost</th></tr></thead><tbody>
            {selected.sources.filter(source => source.name !== "Attack supplies").map(source => <tr key={source.name}><td>{source.name}</td><td>{source.energy ? `${count(source.energy)}E` : "—"}</td><td>{source.count ? count(source.count) : "—"}</td><td>{formatMoney(source.cost)}</td></tr>)}
          </tbody></table></div></div>
          <div className="halloween-insights"><h3>What changes the outcome</h3>
            <p><strong>{count(selected.exchangedTreats)} treats exchanged</strong><br />{count(selected.earnedTreats)} earned from attacks{settings.mortalCoil ? " / Mortal Coil" : ""} · {settings.cashback ? `${count(selected.cashbackTreats)} returned by Cashback` : "Cashback disabled"}.</p>
            {selected.unexchangedTreats > 1e-8 && <p><strong>{count(selected.unexchangedTreats)} treats left unexchanged</strong><br />Carried in the basket; excluded from reward value and net profit.</p>}
            {breakEvenBooster !== null && <p><strong>{formatMoney(breakEvenBooster)} per {selected.booster === "fhc" ? "FHC" : "can"}</strong><br />Maximum price for paid boosters to outperform using this book without them, at your current settings.</p>}
            {alternativeWeapon && <p><strong>{formatMoney(alternativeWeapon.profit - selected.profit)} profit change</strong><br />Switching to {settings.weapon === "scary" ? `${settings.revitalize}% Revitalize` : "a scary weapon"}, keeping this book and booster.<br />{alternativeWeapon.attacks >= selected.attacks ? "+" : ""}{count(alternativeWeapon.attacks - selected.attacks)} attacks ({count(alternativeWeapon.attacks)} total). Equipment purchase costs are excluded.</p>}
            {energyLosses.map(row => <p key={row.label}><strong>{count(row.energy)}E {row.label}</strong></p>)}
          </div>
        </div>
      </section>
    </>}
    {selected && baseline && selectedNoBook && <HalloweenStrategyBreakdown selected={selected} baseline={baseline} noBook={selectedNoBook} settings={settings} />}
    <section className="panel halloween-method"><details><summary>How the estimate works</summary>
      {selected && alternativeWeapon && <p><strong>Simulated treats per attack</strong><br />
        {basket.name} basket: {basket.treatChance}% base treat chance, fixed throughout the event.<br />
        Scary weapon: {getSimulatedTreatsPerAttack(settings.weapon === "scary" ? selected : alternativeWeapon).toLocaleString(undefined, { maximumFractionDigits: 6 })}<br />
        Revitalize weapon: {getSimulatedTreatsPerAttack(settings.weapon === "revitalize" ? selected : alternativeWeapon).toLocaleString(undefined, { maximumFractionDigits: 6 })}<br />
        Averages use the selected book and boosters for each weapon, across {displayedRuns.toLocaleString()} simulated events. Only attack drops are counted; Mortal Coil and exchange bonuses are excluded. Scary clothing is {settings.scaryClothing ? "included" : "excluded"} for both weapon choices. Cat in Hell excluded.
      </p>}
      <p>This is an expected-value comparison, not a prediction of individual drops. The selected basket level stays fixed throughout the event; automatic basket progression is not modelled. Basket level changes only the base treat chance; the purchased-upgrade assumptions and selected upgrade settings apply at every level, even where those upgrades would normally still be locked. The Upgrades settings control Dark Power, Freebie, Cashback and Mortal Coil. All other basket upgrades are assumed owned, but Cat in Hell and Inflation are excluded from the calculation. The basket starts empty, and every attack succeeds. Each book covers the full event; its remaining 24 days have no assigned value. No book purchase cost is assumed.</p>
      <p>The likely profit range uses the 10th and 90th percentiles of the same {displayedRuns.toLocaleString()} runs used for the average: roughly 10% of simulated outcomes fall below it and 10% above it. It reflects random treat drops and Revitalize procs where applicable, with prices and all other assumptions held fixed. It is an estimated range of event outcomes, not a guarantee or a confidence interval for the average.</p>
      <p>Only one finishing weapon is used. Revitalize returns 25E on a successful proc and gives up the scary-weapon treat bonus. Recycled energy is attacked again.</p>
      <p>Dark Power is {settings.darkPower ? "enabled" : "disabled"}, Freebie is {settings.freebie ? "enabled" : "disabled"}, and Cashback is {settings.cashback ? "enabled" : "disabled"}. Mortal Coil is {settings.mortalCoil ? "enabled, adding one treat per hour (168 over the event)" : "disabled"}. Exchanges target 100 treats and exchange the whole basket. With Freebie and Dark Power enabled, a 100-treat exchange returns 550E and requires no more than 450E already held. If an attack skips 100, the model tries for 110 or 120. Once the basket reaches 120 or more, it exchanges at the first safe opportunity, even if the total is not a multiple of 10. If a rare stacked drop makes the exchange too large even from empty, the model spends all energy that can fund attacks, exchanges the basket and records energy lost above the 1,000E cap. Freebie and Cashback are rounded down per batch; Cashback is calculated before Freebie. During the final hour, exchanges below 100 are allowed. The model prefers multiples of 10 while attacks are available, but exchanges a smaller non-multiple when attacks stall. Baskets below 10 are saved until the final minute. Returned energy funds more attacks before the cutoff; any remaining basket and Cashback are then cashed out without post-event attacks.</p>
      <p>The entered price per treat includes Freebie's item bonus; disabling Freebie divides that value by 1.1. Revenue and the graph account for the actual whole Freebie rewards in each batch; the effective value per treat reflects any rounding. Break-even is quoted in the same units as the price input. Each attack rolls the basket's treat chance, then independently rolls Doubler (20%), Tripler (10%), Quadrupler (5%) and Quintupler (1%). These multipliers can stack. Treats enter the basket as whole numbers; the treats-per-attack figures above divide total attack drops by total attacks across the simulations. Every attack requires 25E upfront. Revitalize rolls the selected chance after each attack, returning either 25E or nothing. Returned energy can fund more whole attacks, and unused energy carries forward. Results average {displayedRuns.toLocaleString()} repeatable simulations, so displayed averages may include fractional attacks, treats or procs. Matching rolls across strategies keep comparisons consistent, and reward values use your flat price per treat.</p>
      <p>The event starts at 12:00 TCT and runs for 168 hours with continuous activity. Supplies per attack and other event costs are fixed at $0. The schedule uses one-minute steps and whole attacks, with no attack-rate limit, hospital time or overdoses. Natural regeneration is capped by maximum energy. Daily and special refills aim for 0E, waiting for other energy to fund another attack where practical; daily refills are always used before the day ends. For FHCs, energy is spent on attacks in preparation for cooldown becoming available, then each FHC is used immediately. A remainder below 25E never delays an FHC and is deducted from the energy it adds. Exchanges take priority over refills when the refill would leave insufficient room for the basket energy. Exchanges and other energy claims never raise energy above 1,000E; any excess from the one-off claim is recorded as lost. Returned energy funds more attacks during the event, but cannot fund Halloween attacks after the event ends.</p>
      <p>Xanax is used in every strategy. Daily energy refills reset at midnight TCT and are assumed available and used on all eight calendar dates, including the first day. Their cost is excluded from profit calculations. Special refills aim for 0E and must all be used before the first daily refill, with a top-up fallback before midnight if needed. Up to 100 company points are redeemed daily. Jobs award new points at 18:00 TCT.</p>
      <p>Eggs, cans and FHCs share booster cooldown. An item can be used while cooldown is below the maximum and may take it above that maximum. No further item is used until cooldown falls below the limit. Owned eggs are used first. Booster costs cover only this event; edit prices to reflect your own costs. Starting energy has no assigned cost.</p>
      <p>Mechanics: <a href="https://wiki.torn.com/wiki/Trick_or_Treat" target="_blank" rel="noreferrer">Torn Halloween wiki</a> · <a href="https://wiki.torn.com/wiki/Energy" target="_blank" rel="noreferrer">Energy</a> · <a href="https://wiki.torn.com/wiki/Books" target="_blank" rel="noreferrer">Books</a> · <a href="https://wiki.torn.com/wiki/Weapon_Bonus" target="_blank" rel="noreferrer">Weapon bonuses</a> · <a href="https://wiki.torn.com/wiki/Item_Cooldowns" target="_blank" rel="noreferrer">Cooldowns</a>.</p>
    </details></section>
  </div>;
}
