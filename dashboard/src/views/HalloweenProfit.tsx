import React from "react";
import { Ghost, RotateCcw, Settings2, X, Trophy, TrendingDown, Wallet, Swords } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard, PanelHeader } from "../components/Common";
import { NumberField, PopoutButton } from "../components/TrainingCalculatorInputs";
import { getHalloweenPrices, type HalloweenPriceSnapshot } from "../api/halloweenPrices";
import { ENERGY_DRINK_TIERS } from "../utils/energyDrinkStrategy";
import { compareHalloween, DEFAULT_HALLOWEEN, HALLOWEEN_BOOKS, HALLOWEEN_BOOSTERS,
  HALLOWEEN_COMPANIES, simulateHalloween, validateHalloween,
  type HalloweenBook, type HalloweenSettings, type HalloweenResult } from "../utils/halloweenProfit";
import { formatMoney, formatCompact } from "./BookStrategy.helpers";
import "./HalloweenProfit.css";
import { HalloweenStrategyBreakdown } from "./HalloweenStrategyBreakdown";

type NumericKey = { [K in keyof HalloweenSettings]: HalloweenSettings[K] extends number ? K : never }[keyof HalloweenSettings];
const numberKeys = Object.keys(DEFAULT_HALLOWEEN).filter(key => typeof DEFAULT_HALLOWEEN[key as keyof HalloweenSettings] === "number") as NumericKey[];
const initialNumbers = () => Object.fromEntries(numberKeys.map(key => [key, String(DEFAULT_HALLOWEEN[key])])) as Record<NumericKey, string>;
const parse = (value: string) => {
  const match = value.replace(/[$,\s]/g, "").match(/^(-?\d+(?:\.\d+)?|\.\d+)([kmb])?$/i);
  return match ? Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1) : NaN;
};
const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const bookName = (book: HalloweenBook) => HALLOWEEN_BOOKS.find(item => item.id === book)!.name;
const boosterName = (id: string) => HALLOWEEN_BOOSTERS.find(item => item.id === id)!.name;
const strategyName = (row: HalloweenResult) => `${bookName(row.book)} · ${boosterName(row.booster)}`;

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
  const [prices, setPrices] = React.useState<string[]>(ENERGY_DRINK_TIERS.map(tier => tier.price));
  const [books, setBooks] = React.useState<HalloweenBook[]>(HALLOWEEN_BOOKS.map(book => book.id));
  const [popout, setPopout] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
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
  const settings = React.useMemo(() => ({ ...options,
    ...Object.fromEntries(numberKeys.map(key => [key, parse(numbers[key])])), canPrices: prices.map(parse),
  }) as HalloweenSettings, [options, numbers, prices]);
  const error = validateHalloween(settings);
  const results = React.useMemo(() => error ? [] : compareHalloween(settings), [settings, error]);
  const ranked = results.filter(row => books.includes(row.book)).sort((a, b) => b.profit - a.profit);
  const rows = sort === "lowest" ? [...ranked].reverse() : ranked;
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const baseline = results.find(row => row.id === "none:none");
  const selected = ranked.find(row => row.id === selectedId) ?? best;
  const energyLosses = selected ? [
    { label: "regeneration lost", energy: selected.wastedRegeneration },
    { label: "Dark Power lost to the cap", energy: selected.wastedDarkEnergy },
    { label: "left after the event", energy: selected.unusedEnergy },
  ].filter(row => Math.round(row.energy * 10) > 0) : [];
  const selectedNoBooster = results.find(row => row.book === selected?.book && row.booster === "none");
  const selectedNoBook = results.find(row => row.book === "none" && row.booster === selected?.booster);
  const alternativeWeapon = React.useMemo(() => selected && !error
    ? simulateHalloween({ ...settings, weapon: settings.weapon === "scary" ? "revitalize" : "scary" }, selected.book, selected.booster) : null,
  [settings, selected, error]);
  const chart = selected?.timeline.map((point, index) => ({ ...point, baseline: baseline?.timeline[index].profit }));
  const change = <K extends keyof HalloweenSettings>(key: K, value: HalloweenSettings[K]) => setOptions(current => ({ ...current, [key]: value }));
  const field = (key: NumericKey, label: string, suffix?: string, title?: string, disabled = false) =>
    <NumberField key={key} label={label} value={numbers[key]} suffix={suffix} title={title} disabled={disabled}
      onChange={value => { if (key === "fhcPrice") clearPriceSource(); setNumbers(current => ({ ...current, [key]: value })); }} />;
  const toggle = (key: "donor" | "scaryClothing", label: string) =>
    <label className="halloween-toggle"><input type="checkbox" checked={options[key]} onChange={event => change(key, event.target.checked)} />{label}</label>;
  const reset = () => { resetPrices(); setPriceNotice(null); setOptions(DEFAULT_HALLOWEEN); setNumbers(initialNumbers());
    setBooks(HALLOWEEN_BOOKS.map(b => b.id)); setSelectedId(null); setPopout(null); setSort("highest"); };
  const bonusProfit = selected && selectedNoBooster ? selected.profit - selectedNoBooster.profit : 0;
  const boosterSpend = selected?.sources.find(source => source.name === boosterName(selected.booster))?.cost ?? 0;
  const breakEvenBooster = selected?.boosterCount ? (bonusProfit + boosterSpend) / selected.boosterCount : null;

  return <div className="halloween-profit">
    <section className="panel halloween-heading">
      <div><div className="panel-kicker"><Ghost size={18} /> SEASONAL CALCULATOR</div><h1>Halloween profit</h1>
        <p>Find the books and boosters that make your seven days of attacking most profitable.</p></div>
      <button type="button" className="book-strategy-popout-button" onClick={reset}><RotateCcw size={15} />Reset</button>
      <div className="halloween-assumptions"><span>Max basket upgrades</span><span>100% attack success</span><span>All energy used for attacks</span><span>Full 7-day book overlap</span></div>
    </section>

    <section className="panel book-strategy-input-panel halloween-settings" ref={panel}>
      <PanelHeader title="Event & prices" icon={<Settings2 size={18} />} />
      <div className="halloween-fields">
        {field("treatPrice", "Price per treat", "$", "Average net sale value per treat exchanged, including the extra item from Freebie. Editable planning estimate; not a live market quote.")}
        <label className="book-strategy-field"><span>Finishing weapon</span><select value={options.weapon} onChange={event => change("weapon", event.target.value as HalloweenSettings["weapon"])}>
          <option value="scary">Scary weapon</option><option value="revitalize">Revitalize weapon</option></select></label>
        {options.weapon === "revitalize" ? field("revitalize", "Revitalize chance", "%") : <div className="halloween-inline-note">Scary finish adds 10 percentage points to your treat chance.</div>}
        {toggle("scaryClothing", "Wear scary clothing")}
      </div>
      <div className="halloween-controls">{["Energy & drugs", "Boosters", "Prices", "Company"].map(label =>
        <PopoutButton key={label} label={label} icon={<Settings2 size={14} />} active={popout === label} onClick={() => setPopout(popout === label ? null : label)} />)}</div>
      {popout && <div className="book-strategy-popout halloween-popout" role="region" aria-label={popout}>
        <div className="halloween-popout-title"><strong>{popout}</strong><button type="button" aria-label="Close settings" onClick={() => setPopout(null)}><X size={18} /></button></div>
        <div className="book-strategy-popout-grid">
          {popout === "Energy & drugs" && <>
            {toggle("donor", "Donator regeneration")}
            <p className="halloween-wide">Xanax is assumed for every strategy. Daily energy refills are always available and used on all eight calendar days; refill costs are excluded.</p>
            {field("startingEnergy", "Starting energy", "E", "Energy already stacked when the event begins. Its cost is excluded from the comparison.")}
            {field("specialRefills", "Special energy refills", "refills", "Free refills, used before the first daily points refill; maximum 100.")}
            {field("extraEnergy", "Other one-off energy", "E", "One claim at the first active moment, after spending stored energy. Use for stock or newsletter energy; maximum 1,000E.")}
            {field("drugPrice", "Price per Xanax", "$")}
            {field("drugInterval", "Time between Xanax", "hours", "Planning interval, including time you wait after cooldown. No overdoses are simulated.")}
            {field("drugDelay", "Starting drug cooldown", "hours")}
          </>}
          {popout === "Boosters" && <>
            {field("factionBonus", "Faction can bonus", "%")}
            {field("maxCooldown", "Maximum booster cooldown", "hours")}
            {field("startingCooldown", "Starting booster cooldown", "hours")}
            {field("greenEggs", "Available Green Easter eggs", "eggs", "500E and 6h cooldown each. Used before paid boosters; also included in the baseline. Eggs are valued at $0.")}
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
      <p className="halloween-note">Default item prices are based on the annual low for each item, not live market prices.</p>
    </section>

    <section className="panel"><PanelHeader title="Books to compare" aside="One book at a time" />
      <div className="halloween-books">{HALLOWEEN_BOOKS.map(book => <label key={book.id} className={books.includes(book.id) ? "selected" : ""}>
        <input type="checkbox" checked={books.includes(book.id)} disabled={book.id === "none"} onChange={event => setBooks(current => event.target.checked ? [...current, book.id] : current.filter(id => id !== book.id))} />
        <span><strong>{book.name}</strong><small>{book.description}</small></span></label>)}</div>
    </section>
    {error ? <section className="panel halloween-error" role="alert">{error}</section> : best && worst && baseline && selected && <>
      <div className="halloween-metrics">
        <MetricCard label="Highest net profit" value={formatMoney(best.profit)} detail={strategyName(best)} icon={<Trophy size={16} />} />
        <MetricCard label="Lowest net profit" value={formatMoney(worst.profit)} detail={strategyName(worst)} icon={<TrendingDown size={16} />} />
        <MetricCard label="Best uplift over baseline" value={formatMoney(best.profit - baseline.profit)} detail="Compared with no book and no paid boosters" icon={<Wallet size={16} />} />
        <MetricCard label="Baseline net profit" value={formatMoney(baseline.profit)} detail="Same weapon, company, drugs, refills and free energy" icon={<Swords size={16} />} />
      </div>
      <section className="panel"><PanelHeader title="Strategy comparison" control={<label className="halloween-sort">Sort <select value={sort} onChange={event => setSort(event.target.value)}><option value="highest">Highest profit first</option><option value="lowest">Lowest profit first</option></select></label>} />
        <p className="halloween-note">{ranked.length} strategies · Select a row to inspect its profit and energy breakdown. Smaller figures show the difference from no book and no paid boosters, with the same weapon and energy settings. Quantities are expected averages.</p>
        <div className="halloween-table-scroll"><table className="halloween-table"><thead><tr><th>Book / booster</th><th>Boosters</th><th>Attacks</th><th>Treats exchanged</th><th>Reward value</th><th>Total spent</th><th>Net profit</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.id === selected.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}>
            <td><button type="button" aria-pressed={row.id === selected.id} onClick={() => setSelectedId(row.id)}>{bookName(row.book)}<small>{boosterName(row.booster)}</small></button></td>
            <td>{row.boosterCount || "—"}<BaselineDifference value={row.boosterCount} baseline={baseline.boosterCount} /></td>
            <td>{count(row.attacks)}<BaselineDifference value={row.attacks} baseline={baseline.attacks} /></td>
            <td>{count(row.exchangedTreats)}<BaselineDifference value={row.exchangedTreats} baseline={baseline.exchangedTreats} /></td>
            <td>{formatMoney(row.revenue)}<BaselineDifference value={row.revenue} baseline={baseline.revenue} money /></td>
            <td>{formatMoney(row.cost)}<BaselineDifference value={row.cost} baseline={baseline.cost} money /></td>
            <td className={row.profit >= 0 ? "halloween-positive" : "halloween-negative"}>{formatMoney(row.profit)}<BaselineDifference value={row.profit} baseline={baseline.profit} money /></td>
          </tr>)}</tbody></table></div>
      </section>
      <section className="panel halloween-detail"><PanelHeader title={strategyName(selected)} aside="Selected strategy" />
        <div className="halloween-metrics">
          <MetricCard label="Net profit" value={formatMoney(selected.profit)} detail={`${formatMoney(selected.revenue)} rewards − ${formatMoney(selected.cost)} costs`} icon={<Wallet size={16} />} />
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
            <p><strong>{count(selected.exchangedTreats)} treats exchanged</strong><br />{count(selected.earnedTreats)} earned from attacks / Mortal Coil · {count(selected.cashbackTreats)} returned by Cashback · {count(selected.inflationTreats)} from Inflation.</p>
            {breakEvenBooster !== null && <p><strong>{formatMoney(breakEvenBooster)} per {selected.booster === "fhc" ? "FHC" : "can"}</strong><br />Maximum price for paid boosters to outperform using this book without them, at your current settings.</p>}
            {alternativeWeapon && <p><strong>{formatMoney(alternativeWeapon.profit - selected.profit)} profit change</strong><br />Switching to {settings.weapon === "scary" ? `${settings.revitalize}% Revitalize` : "a scary weapon"}, keeping this book and booster.<br />{alternativeWeapon.attacks >= selected.attacks ? "+" : ""}{count(alternativeWeapon.attacks - selected.attacks)} attacks ({count(alternativeWeapon.attacks)} total). Equipment purchase costs are excluded.</p>}
            {energyLosses.map(row => <p key={row.label}><strong>{count(row.energy)}E {row.label}</strong></p>)}
          </div>
        </div>
      </section>
    </>}
    {selected && baseline && selectedNoBook && <HalloweenStrategyBreakdown selected={selected} baseline={baseline} noBook={selectedNoBook} settings={settings} />}
    <section className="panel halloween-method"><details><summary>How the estimate works</summary>
      {selected && alternativeWeapon && <p><strong>Treats per attack</strong><br />
        Scary weapon: {(settings.weapon === "scary" ? selected : alternativeWeapon).treatsPerAttack.toLocaleString(undefined, { maximumFractionDigits: 6 })}<br />
        Revitalize weapon: {(settings.weapon === "revitalize" ? selected : alternativeWeapon).treatsPerAttack.toLocaleString(undefined, { maximumFractionDigits: 6 })}<br />
        Scary clothing {settings.scaryClothing ? "included" : "excluded"}. Cat in Hell excluded. Cashback and other basket rewards are calculated separately.
      </p>}
      <p>This is an expected-value comparison, not a prediction of individual drops. All basket upgrades are owned, but Cat in Hell is excluded from the calculation. The basket starts empty, and every attack succeeds. Each book covers the full event; its remaining 24 days have no assigned value. No book purchase cost is assumed.</p>
      <p>Only one finishing weapon is used. Revitalize returns 25E on a successful proc and gives up the scary-weapon treat bonus. Recycled energy is attacked again. Scary clothing is independent of weapon choice.</p>
      <p>Dark Power, Freebie energy, Cashback, Mortal Coil and hourly Inflation are included. Treats are exchanged repeatedly and returned energy is attacked while active. Reward value equals treats exchanged × your price per treat; Freebie item value is already included in that price. Fractional attacks and treats describe averages, so small real-world rounding differences are expected.</p>
      <p>The event starts at 12:00 TCT and runs for 168 hours with continuous activity and frequent treat exchanges. Supplies per attack and other event costs are fixed at $0. The schedule uses one-minute steps and immediate attacks, with no attack-rate limit, hospital time or overdoses. Natural regeneration is capped by maximum energy; other energy is spent before the next claim. A treat exchange is capped at 1,000E, and frequent exchanges minimise wasted energy.</p>
      <p>Xanax is used in every strategy. Daily energy refills reset at midnight TCT and are assumed available and used on all eight calendar dates, including the first day. Their cost is excluded from profit calculations. Special refills are used first. Up to 100 company points are redeemed daily. Jobs award new points at 18:00 TCT.</p>
      <p>Eggs, cans and FHCs share booster cooldown. An item can be used while cooldown is below the maximum and may take it above that maximum. No further item is used until cooldown falls below the limit. Owned eggs are used first. Booster costs cover only this event; edit prices to reflect your own costs. Starting energy has no assigned cost.</p>
      <p>Mechanics: <a href="https://wiki.torn.com/wiki/Trick_or_Treat" target="_blank" rel="noreferrer">Torn Halloween wiki</a> · <a href="https://wiki.torn.com/wiki/Energy" target="_blank" rel="noreferrer">Energy</a> · <a href="https://wiki.torn.com/wiki/Books" target="_blank" rel="noreferrer">Books</a> · <a href="https://wiki.torn.com/wiki/Weapon_Bonus" target="_blank" rel="noreferrer">Weapon bonuses</a> · <a href="https://wiki.torn.com/wiki/Item_Cooldowns" target="_blank" rel="noreferrer">Cooldowns</a>.</p>
    </details></section>
  </div>;
}
