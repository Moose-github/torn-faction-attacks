import React from "react";
import { Ghost, RotateCcw, Settings2, X, Trophy, TrendingDown, Wallet, Swords } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MetricCard, PanelHeader } from "../components/Common";
import { NumberField, PopoutButton } from "../components/TrainingCalculatorInputs";
import { ENERGY_DRINK_TIERS } from "../utils/energyDrinkStrategy";
import { compareHalloween, DEFAULT_HALLOWEEN, HALLOWEEN_BOOKS, HALLOWEEN_BOOSTERS,
  HALLOWEEN_COMPANIES, simulateHalloween, validateHalloween,
  type HalloweenBook, type HalloweenSettings, type HalloweenResult } from "../utils/halloweenProfit";
import { formatMoney, formatCompact } from "./BookStrategy.helpers";
import "./HalloweenProfit.css";

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

export function HalloweenProfit() {
  const [options, setOptions] = React.useState(DEFAULT_HALLOWEEN);
  const [numbers, setNumbers] = React.useState(initialNumbers);
  const [prices, setPrices] = React.useState<string[]>(ENERGY_DRINK_TIERS.map(tier => tier.price));
  const [books, setBooks] = React.useState<HalloweenBook[]>(HALLOWEEN_BOOKS.map(book => book.id));
  const [popout, setPopout] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState("highest");
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
  const selectedNoBooster = results.find(row => row.book === selected?.book && row.booster === "none");
  const selectedNoBook = results.find(row => row.book === "none" && row.booster === selected?.booster);
  const alternativeWeapon = React.useMemo(() => selected && !error
    ? simulateHalloween({ ...settings, weapon: settings.weapon === "scary" ? "revitalize" : "scary" }, selected.book, selected.booster) : null,
  [settings, selected, error]);
  const chart = selected?.timeline.map((point, index) => ({ ...point, baseline: baseline?.timeline[index].profit }));
  const change = <K extends keyof HalloweenSettings>(key: K, value: HalloweenSettings[K]) => setOptions(current => ({ ...current, [key]: value }));
  const field = (key: NumericKey, label: string, suffix?: string, title?: string, disabled = false) =>
    <NumberField key={key} label={label} value={numbers[key]} suffix={suffix} title={title} disabled={disabled}
      onChange={value => setNumbers(current => ({ ...current, [key]: value }))} />;
  const toggle = (key: "donor" | "scaryClothing" | "dailyRefill" | "firstRefill", label: string) =>
    <label className="halloween-toggle"><input type="checkbox" checked={options[key]} onChange={event => change(key, event.target.checked)} />{label}</label>;
  const reset = () => { setOptions(DEFAULT_HALLOWEEN); setNumbers(initialNumbers()); setPrices(ENERGY_DRINK_TIERS.map(t => t.price));
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
      <div className="halloween-controls">{["Energy & drugs", "Boosters & prices", "Company", "Activity & costs"].map(label =>
        <PopoutButton key={label} label={label} icon={<Settings2 size={14} />} active={popout === label} onClick={() => setPopout(popout === label ? null : label)} />)}</div>
      {popout && <div className="book-strategy-popout halloween-popout" role="region" aria-label={popout}>
        <div className="halloween-popout-title"><strong>{popout}</strong><button type="button" aria-label="Close settings" onClick={() => setPopout(null)}><X size={18} /></button></div>
        <div className="book-strategy-popout-grid">
          {popout === "Energy & drugs" && <>
            {toggle("donor", "Donator regeneration")}{toggle("dailyRefill", "Daily points refill")}
            {toggle("firstRefill", "First day's refill available")}
            {field("pointPrice", "Price per point", "$", "Each daily energy refill costs 30 points.", !options.dailyRefill)}
            {field("startingEnergy", "Starting energy", "E", "Energy already stacked when the event begins; include its cost in preparation cost.")}
            {field("preparationCost", "Preparation cost", "$")}
            {field("specialRefills", "Special energy refills", "refills", "Free refills, used before the first daily points refill; maximum 100.")}
            {field("extraEnergy", "Other one-off energy", "E", "One claim at the first active moment, after spending stored energy. Use for stock or newsletter energy; maximum 1,000E.")}
            <label className="book-strategy-field"><span>Drug</span><select value={options.drug} onChange={event => {
              const drug = event.target.value as HalloweenSettings["drug"]; change("drug", drug);
              setNumbers(current => ({ ...current, drugPrice: drug === "lsd" ? "22k" : "875k", drugInterval: "8" }));
            }}><option value="none">None</option><option value="xanax">Xanax · 250E</option><option value="lsd">LSD · 50E</option></select></label>
            {field("drugPrice", "Price per drug", "$", undefined, options.drug === "none")}
            {field("drugInterval", "Time between drugs", "hours", "Planning interval, including time you wait after cooldown. No overdoses are simulated.", options.drug === "none")}
            {field("drugDelay", "Starting drug cooldown", "hours", undefined, options.drug === "none")}
          </>}
          {popout === "Boosters & prices" && <>
            {field("factionBonus", "Faction can bonus", "%")}
            {field("maxCooldown", "Maximum booster cooldown", "hours")}
            {field("startingCooldown", "Starting booster cooldown", "hours")}
            {field("fhcPrice", "Price per FHC", "$")}
            {ENERGY_DRINK_TIERS.map((tier, index) => <NumberField key={tier.energy} label={`${tier.energy}E can price`} title={tier.name} suffix="$" value={prices[index]}
              onChange={value => setPrices(current => current.map((price, i) => i === index ? value : price))} />)}
            {field("greenEggs", "Available Green Easter eggs", "eggs", "500E and 6h cooldown each. Used before paid boosters; also included in the baseline.")}
            <p className="halloween-wide">Default can prices are based on the annual low point, not live market prices. Enter your own purchase prices. Owned boosters still have a cost; eggs are valued at $0.</p>
          </>}
          {popout === "Company" && <>
            <label className="book-strategy-field halloween-wide"><span>Company specials</span><select value={options.company} onChange={event => change("company", event.target.value as HalloweenSettings["company"])}>
              {HALLOWEEN_COMPANIES.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
            {field("jobPoints", "Banked job points", "JP", "Redeem up to 100 per calendar day.", !HALLOWEEN_COMPANIES.find(c => c.id === options.company)?.energy)}
            {field("dailyJobPoints", "Job points earned daily", "JP", "Added at 18:00 TCT.", !HALLOWEEN_COMPANIES.find(c => c.id === options.company)?.energy)}
            <p className="halloween-wide">Grocery: −10% can cooldown, plus +10% can energy at 7★. Restaurant: −25% can cooldown and 3E/JP. Farm: 7E/JP. Candle / Game shop: 5E/JP. Company benefits apply only to the selected company.</p>
          </>}
          {popout === "Activity & costs" && <>
            {field("startHour", "Event start", "TCT hour", "Your assigned start between 10:00 and 16:00. The event runs for exactly 168 hours.")}
            {field("sleepHours", "Daily inactive time", "hours", "No attacks, exchanges or item use while inactive. Natural regeneration stops at your energy cap.")}
            {field("sleepStart", "Inactive from", "TCT hour", "Use decimal hours: 23.5 means 23:30.")}
            {field("exchangeHours", "Time between exchanges", "hours", "0 means frequent exchanges to recycle Dark Power. Larger intervals can lose energy to the 1,000E cap. The final exchange is made before your last active minute ends.")}
            {field("attackCost", "Supplies per attack", "$", "Average ammo, medical and temporary-item expense per attack.")}
            {field("otherCost", "Other event costs", "$", "Include company fees or other fixed expenses here.")}
          </>}
        </div>
      </div>}
      <p className="halloween-note">Price per treat is a flat valuation of exchanged rewards. The $750,000 default is a planning estimate; changing it updates every strategy.</p>
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
        <p className="halloween-note">{ranked.length} strategies · Select a row to inspect its profit and energy breakdown. Quantities are expected averages.</p>
        <div className="halloween-table-scroll"><table className="halloween-table"><thead><tr><th>Book / booster</th><th>Boosters</th><th>Attacks</th><th>Treats exchanged</th><th>Reward value</th><th>Total spent</th><th>Net profit</th><th>Extra vs baseline</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className={row.id === selected.id ? "selected" : ""} onClick={() => setSelectedId(row.id)}>
            <td><button type="button" aria-pressed={row.id === selected.id} onClick={() => setSelectedId(row.id)}>{bookName(row.book)}<small>{boosterName(row.booster)}</small></button></td>
            <td>{row.boosterCount || "—"}</td><td>{count(row.attacks)}</td><td>{count(row.exchangedTreats)}</td><td>{formatMoney(row.revenue)}</td><td>{formatMoney(row.cost)}</td>
            <td className={row.profit >= 0 ? "halloween-positive" : "halloween-negative"}>{formatMoney(row.profit)}</td><td>{formatMoney(row.profit - baseline.profit)}</td>
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
            {selected.sources.map(source => <tr key={source.name}><td>{source.name}</td><td>{source.energy ? `${count(source.energy)}E` : "—"}</td><td>{source.count ? count(source.count) : "—"}</td><td>{formatMoney(source.cost)}</td></tr>)}
          </tbody></table></div></div>
          <div className="halloween-insights"><h3>What changes the outcome</h3>
            <p><strong>{count(selected.exchangedTreats)} treats exchanged</strong><br />{count(selected.earnedTreats)} earned from attacks / Mortal Coil · {count(selected.cashbackTreats)} returned by Cashback · {count(selected.inflationTreats)} from Inflation.</p>
            {breakEvenBooster !== null && <p><strong>{formatMoney(breakEvenBooster)} per {selected.booster === "fhc" ? "FHC" : "can"}</strong><br />Maximum price for paid boosters to outperform using this book without them, at your current settings.</p>}
            {alternativeWeapon && <p><strong>{formatMoney(alternativeWeapon.profit - selected.profit)} profit change</strong><br />Switching to {settings.weapon === "scary" ? `${settings.revitalize}% Revitalize` : "a scary weapon"}, keeping this book and booster. Equipment purchase costs are excluded.</p>}
            <p><strong>{count(selected.wastedRegeneration)}E regeneration lost</strong><br />{count(selected.wastedDarkEnergy)}E Dark Power lost to the cap · {count(selected.unusedEnergy)}E left after your last active period.</p>
          </div>
        </div>
      </section>
    </>}
    <section className="panel halloween-method"><details><summary>How the estimate works</summary>
      <p>This is an expected-value comparison, not a prediction of individual drops. All basket upgrades are owned, the basket starts empty, and every attack succeeds. Each book covers the full event; its remaining 24 days have no assigned value. No book purchase cost is assumed.</p>
      <p>Only one finishing weapon is used. Revitalize returns 25E on a successful proc and gives up the scary-weapon treat bonus. Recycled energy is attacked again. Scary clothing is independent of weapon choice.</p>
      <p>Dark Power, Freebie energy, Cashback, Mortal Coil and hourly Inflation are included. Treats are exchanged repeatedly and returned energy is attacked while active. Reward value equals treats exchanged × your price per treat; Freebie item value is already included in that price. Fractional attacks and treats describe averages, so small real-world rounding differences are expected.</p>
      <p>The schedule uses one-minute steps and immediate attacks while active, with no attack-rate limit, hospital time or overdoses. Natural regeneration is capped by maximum energy; other energy is spent before the next claim. A treat exchange is capped at 1,000E. Frequent exchanges minimise wasted energy; delayed exchanges trade energy for Inflation. Treats left after a final inactive period are sold after the event; their returned energy cannot earn more Halloween treats.</p>
      <p>Daily paid refills cost 30 points and reset at midnight TCT. The seven-day event spans eight calendar dates; the first refill can be disabled if already used. Special refills are used first. Up to 100 company points are redeemed daily. Jobs award new points at 18:00 TCT.</p>
      <p>Eggs, cans and FHCs share booster cooldown. An item can be used while cooldown is below the maximum and may take it above that maximum. No further item is used until cooldown falls below the limit. Owned eggs are used first. Booster and preparation costs cover only this event; edit prices to reflect your own costs.</p>
      <p>Mechanics: <a href="https://wiki.torn.com/wiki/Trick_or_Treat" target="_blank" rel="noreferrer">Torn Halloween wiki</a> · <a href="https://wiki.torn.com/wiki/Energy" target="_blank" rel="noreferrer">Energy</a> · <a href="https://wiki.torn.com/wiki/Books" target="_blank" rel="noreferrer">Books</a> · <a href="https://wiki.torn.com/wiki/Weapon_Bonus" target="_blank" rel="noreferrer">Weapon bonuses</a> · <a href="https://wiki.torn.com/wiki/Item_Cooldowns" target="_blank" rel="noreferrer">Cooldowns</a>.</p>
    </details></section>
  </div>;
}
