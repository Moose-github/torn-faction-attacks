import { useEffect, useMemo, useRef, useState } from "react";
import { HALLOWEEN_BOOSTERS, HALLOWEEN_COMPANIES, validateHalloween, type HalloweenSettings } from "../utils/halloweenProfit";
import { progressionSettings, type ProgressionCandidate, type ProgressionReport, type ProgressionUpdate } from "../utils/halloweenProgression";
import { HALLOWEEN_PROGRESSION_STARTS } from "../utils/halloweenUpgradePath";
import type { ProgressionRequest, ProgressionResponse } from "../workers/halloweenProgressionWorker";
import { formatMoney } from "./BookStrategy.helpers";
import "./HalloweenProgression.css";

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatMoney(Math.abs(value))}`;
const boosterName = (row: ProgressionCandidate) => row.booster === "none" ? "No paid boosters"
  : `Up to ${row.quantity} ${HALLOWEEN_BOOSTERS.find(booster => booster.id === row.booster)!.name}`;
function Recommendation({ value, baseline }: { value: ProgressionCandidate; baseline: ProgressionCandidate }) {
  return <>
    <strong>{boosterName(value)}</strong>
    <span>{number(value.collected)} treats <small>({value.collected >= baseline.collected ? "+" : ""}{number(value.collected - baseline.collected)} vs baseline)</small></span>
    <span>{value.revenue > 0 ? `Net ${formatMoney(value.profit)}` : `Event spending ${formatMoney(value.cost)}`}
      <small> · {signedMoney(value.profit - baseline.profit)} vs baseline</small></span>
    <small>Boosters: {formatMoney(value.boosterSpend)} · {number(value.completion * 100)}% finish upgrades</small>
  </>;
}

function downloadImage(report: ProgressionReport, priceSource: string, settings: HalloweenSettings) {
  const canvas = document.createElement("canvas");
  canvas.width = 1640; canvas.height = 331 + report.rows.length * 108;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot create the image.");
  ctx.fillStyle = "#0e1828"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const text = (value: string, x: number, y: number, font = "18px system-ui", color = "#c5d4e6") => {
    ctx.font = font; ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  text("Halloween · Progression recommendations", 28, 45, "bold 30px system-ui", "#ffffff");
  text(`Allowance: ${formatMoney(report.allowance)} below no-booster baseline · ${report.runs} simulations per finalist`, 28, 78);
  text(`Full event · Spooky weapon + clothing · No books · Zero unspent treats · ${settings.startingEnergy}E starting energy`, 28, 108);
  text(`${number(24 / settings.drugInterval)} Xanax/day · ${settings.factionBonus}% can bonus · Company: ${HALLOWEEN_COMPANIES.find(company => company.id === settings.company)!.name} · ${settings.maxCooldown}h cooldown (${settings.startingCooldown}h used)`, 28, 136);
  text(`${settings.donor ? "Donator" : "Non-donator"} · 8 free daily refills · ${settings.specialRefills} special refills · ${settings.greenEggs} green eggs · ${settings.jobPoints} job points + ${settings.dailyJobPoints}/day · ${settings.extraEnergy}E extra`, 28, 164, "16px system-ui");
  text(`Prices: FHC ${formatMoney(settings.fhcPrice)} · Cans 5/10/15/20/25/30E: ${settings.canPrices.map(formatMoney).join(" / ")} · Treat ${formatMoney(settings.treatPrice)}`, 28, 192, "16px system-ui");
  text(`${priceSource} · Calculated ${new Date(report.calculatedAt).toLocaleString()}`, 28, 220, "16px system-ui");
  text("STARTING MILESTONE / BASKET", 28, 263, "bold 17px system-ui");
  text("MAX PROFIT", 620, 263, "bold 17px system-ui");
  text(`MAX PROGRESSION · ${formatMoney(report.allowance)} ALLOWANCE`, 1120, 263, "bold 17px system-ui");
  report.rows.forEach((row, i) => {
    const y = 276 + i * 108;
    if (i % 2 === 0) { ctx.fillStyle = "#162438"; ctx.fillRect(16, y, 1608, 108); }
    text(row.label, 28, y + 29, "bold 17px system-ui", "#ffffff");
    text(`${row.basket} · ${HALLOWEEN_PROGRESSION_STARTS.find(start => start.step === row.step)!.collected.toLocaleString()} previously collected`, 28, y + 55);
    for (const [value, x] of [[row.profit, 620], [row.progression, 1120]] as const) {
      text(boosterName(value), x, y + 27, "bold 18px system-ui", "#ffffff");
      text(`${number(value.collected)} treats · ${signedMoney(value.profit - row.baseline.profit)} vs baseline`, x, y + 53, "16px system-ui");
      text(`Boosters ${formatMoney(value.boosterSpend)} · Net ${formatMoney(value.profit)}`, x, y + 78, "16px system-ui");
    }
  });
  text("Best strategies found. Average outcomes; the allowance is not a guaranteed loss limit. Treats are saved until upgrades are complete.", 28, canvas.height - 20, "16px system-ui");
  const link = document.createElement("a");
  link.download = "halloween-progression-recommendations.png"; link.href = canvas.toDataURL("image/png"); link.click();
}

export function HalloweenProgression({ settings: input, pricesLoading, priceSource }: {
  settings: HalloweenSettings; pricesLoading: boolean; priceSource: string;
}) {
  const settingsKey = JSON.stringify(progressionSettings(input));
  const settings = useMemo(() => JSON.parse(settingsKey) as HalloweenSettings, [settingsKey]);
  const [open, setOpen] = useState(false);
  const [allowanceText, setAllowanceText] = useState("25");
  const allowance = Number(allowanceText) * 1e6;
  const validation = validateHalloween(settings) ?? (!allowanceText.trim() || !Number.isFinite(allowance) || allowance < 0 || allowance > 1e12
    ? "Enter an allowance between $0 and $1tn." : null);
  const key = JSON.stringify({ settings, allowance });
  const [result, setResult] = useState<{ key: string; report: ProgressionReport; priceSource: string; settings: HalloweenSettings } | null>(null);
  const [progress, setProgress] = useState<ProgressionUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const worker = useRef<Worker | null>(null);
  const resultCurrent = result?.key === key ? result : null;
  const stop = () => { worker.current?.terminate(); worker.current = null; setProgress(null); };
  useEffect(() => {
    stop(); setError(null); setCancelled(false);
    return () => { worker.current?.terminate(); worker.current = null; };
  }, [key, open]);
  const calculate = (runs: number) => {
    if (validation || pricesLoading) return;
    stop(); setCancelled(false); setError(null);
    setProgress({ completed: 0, total: 13, label: "Preparing progression strategies" });
    try {
      const job = new Worker(new URL("../workers/halloweenProgressionWorker.ts", import.meta.url), { type: "module" });
      worker.current = job;
      job.onmessage = (event: MessageEvent<ProgressionResponse>) => {
        if (worker.current !== job) return;
        const message = event.data;
        if (message.type === "progress") setProgress(message.progress);
        else {
          if (message.type === "error") setError(message.message);
          else setResult({ key, report: message.report, priceSource, settings });
          stop();
        }
      };
      job.onerror = () => { if (worker.current === job) { setError("Unable to calculate recommendations. Please try again."); stop(); } };
      job.postMessage({ settings, allowance, runs, previous: resultCurrent?.report } satisfies ProgressionRequest);
    } catch { setError("Unable to start the recommendation calculation. Please try again."); stop(); }
  };
  return <section className="panel halloween-progression">
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Progression recommendations</summary>
      {open && <div className="halloween-progression-content">
        <p className="halloween-note">Start at each milestone with its upgrades already purchased and zero unspent treats. Use spooky clothing and a spooky weapon, no books, and your current energy, company and price settings. Basket level and upgrade bonuses develop during the event.</p>
        <p className="halloween-note">Buy upgrades in the recommended order. Save all treats until step 20 is complete, then exchange for rewards and energy. Treats collected counts attack drops, Shadow of Doubt’s bonus and Cashback; Freebie rewards are separate. Historical treats are excluded.</p>
        <div className="halloween-progression-actions">
          <label>Allowance below baseline ($m)<input type="number" min="0" max="1000000" step="1" value={allowanceText} onChange={event => setAllowanceText(event.target.value)} /></label>
          <button type="button" className="book-strategy-popout-button" disabled={!!validation || pricesLoading || !!progress} onClick={() => calculate(128)}>Calculate recommendations</button>
          {progress && <button type="button" className="book-strategy-popout-button" onClick={() => { stop(); setCancelled(true); }}>Cancel</button>}
          {resultCurrent && <>
            <button type="button" className="book-strategy-popout-button" disabled={!!progress || pricesLoading || resultCurrent.report.runs === 1024} onClick={() => calculate(1024)}>
              {resultCurrent.report.runs === 1024 ? "Refined · 1,024 runs" : "Refine recommendations"}</button>
            <button type="button" className="book-strategy-popout-button" onClick={() => { try { downloadImage(resultCurrent.report, resultCurrent.priceSource, resultCurrent.settings); } catch { setError("Unable to export the image in this browser."); } }}>Download image</button>
          </>}
        </div>
        {pricesLoading && <p className="halloween-note" role="status">Waiting for Weav3r prices…</p>}
        {validation && <p className="halloween-error" role="alert">{validation}</p>}
        {progress && <div role="status"><p className="halloween-note">{progress.label} · {progress.completed}/{progress.total} starting milestones complete. The search can take a few minutes.</p><progress max={progress.total} value={progress.completed} /></div>}
        {error && <p className="halloween-error" role="alert">{error}</p>}
        {cancelled && <p className="halloween-note" role="status">Calculation cancelled. You can start it again when ready.</p>}
        {result && !resultCurrent && <p className="halloween-note" role="status">Settings have changed. Calculate again to update the recommendations.</p>}
        {resultCurrent && <>
          <p className="halloween-note">{resultCurrent.priceSource} · {resultCurrent.report.runs.toLocaleString()} simulated events per finalist · Best strategies found across booster types and whole-number quantities.</p>
          <div className="halloween-table-scroll"><table className="halloween-table halloween-progression-table">
            <thead><tr><th scope="col">Starting milestone / basket</th><th scope="col">No-booster baseline</th><th scope="col">Max profit</th><th scope="col">Max progression · {formatMoney(allowance)} allowance</th></tr></thead>
            <tbody>{resultCurrent.report.rows.map(row => <tr key={row.step}>
              <th scope="row">{row.label}<small>{row.basket}</small><small>{HALLOWEEN_PROGRESSION_STARTS.find(start => start.step === row.step)!.collected.toLocaleString()} previously collected</small></th>
              <td><strong>{number(row.baseline.collected)} treats</strong><span>{row.baseline.revenue > 0 ? `Net ${formatMoney(row.baseline.profit)}` : `Event spending ${formatMoney(row.baseline.cost)}`}</span></td>
              <td><Recommendation value={row.profit} baseline={row.baseline} /></td>
              <td><Recommendation value={row.progression} baseline={row.baseline} />{row.profit.booster === row.progression.booster && row.profit.quantity === row.progression.quantity && <small>Same strategy as max profit</small>}</td>
            </tr>)}</tbody>
          </table></div>
        </>}
        <p className="halloween-note">Max progression means the most collected treats with average net result no more than the allowance below the same milestone’s no-booster baseline. Before exchanges begin, this is an extra-spending allowance. Unspent treats carry forward without cash value. Actual outcomes can exceed the allowance.</p>
        <p className="halloween-note">One paid booster type per strategy, used as early as cooldown permits up to the stated limit. Save Your Tears, Mortal Coil, Inflation and Summon Him are excluded. Cat in Hell is purchased along the path; its rare jackpot is excluded. Steps 8–16 form one starting milestone. Closing this panel cancels unfinished calculations; completed results remain available.</p>
      </div>}
    </details>
  </section>;
}
