import React from "react";
import { Award, Download, RotateCcw } from "lucide-react";
import { PanelHeader } from "../components/Common";
import { importMerits } from "../api/merits";
import { initialMeritState, meritCost, meritEffect, meritReducer } from "../utils/meritsSimulator";
import type { MeritDefinition } from "../utils/meritDefinitions";
import "./MeritsSimulator.css";

type Preview = { index: number; level: number } | null;
const LEVELS = Array.from({ length: 10 }, (_, index) => index + 1);
const GROUP_ORDER = ["General", "Combat", "Weapons"];
const groupOrder = (group: string) => {
  const order = GROUP_ORDER.indexOf(group);
  return order < 0 ? GROUP_ORDER.length : order;
};

export function MeritsSimulator() {
  const [plan, dispatch] = React.useReducer(meritReducer, undefined, initialMeritState);
  const rows = React.useMemo(() => plan.definitions.map((definition, index) => ({ definition, index }))
    .sort((a, b) => groupOrder(a.definition.group) - groupOrder(b.definition.group)), [plan.definitions]);
  const [preview, setPreview] = React.useState<Preview>(null);
  const [apiKey, setApiKey] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState("");
  const [importExpanded, setImportExpanded] = React.useState(true);
  const importToggle = React.useRef<HTMLButtonElement>(null);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  React.useEffect(() => {
    if (!importExpanded && !loading) importToggle.current?.focus();
  }, [importExpanded, loading]);

  const selectLevel = React.useCallback((index: number, level: number) => {
    dispatch({ type: "level", index, level });
    setPreview(null);
  }, []);
  const previewLevel = React.useCallback((index: number, level: number | null) => {
    setPreview(current => level === null ? (current?.index === index ? null : current)
      : current?.index === index && current.level === level ? current : { index, level });
  }, []);
  const projected = preview ? plan.used - meritCost(plan.levels[preview.index]) + meritCost(preview.level) : plan.used;
  const available = plan.budget - projected;
  const changed = plan.levels.filter((level, index) => level !== plan.baseline[index]).length;

  async function fetchUserMerits(event: React.FormEvent) {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setApiKey("");
    setLoading(true);
    setPreview(null);
    setError(null);
    setMessage("");
    try {
      const snapshot = await importMerits(key, request.signal);
      if (request.signal.aborted || controller.current !== request) return;
      dispatch({ type: "import", snapshot });
      setMessage(`Imported ${snapshot.budget} merits: ${snapshot.used} allocated and ${snapshot.budget - snapshot.used} available. Your key has been discarded.`);
      setImportExpanded(false);
    } catch (reason) {
      if (!request.signal.aborted && controller.current === request) setError(reason instanceof Error ? reason.message : "Unable to import merits. Please try again.");
    } finally {
      if (controller.current === request) { controller.current = null; setLoading(false); }
    }
  }

  function cancelImport() {
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
    setMessage("Import cancelled. Your current plan has been kept.");
  }

  return <div className="merits-simulator">
    <section className="hero-panel compact-hero-panel">
      <div><p className="eyebrow">Miscellaneous · Calculator</p><h2>Merits simulator</h2>
        <p>Simulate merit costs</p></div><Award size={30} aria-hidden="true" />
    </section>

    <section className={`panel merit-import-panel${importExpanded ? "" : " is-collapsed"}`}>
      <PanelHeader title={plan.imported && !importExpanded ? "Merits imported" : "Import your merits"} icon={<Download size={17} />} control={
        <button ref={importToggle} type="button" className="panel-action-button secondary" aria-expanded={importExpanded} aria-controls="merit-import-body"
          disabled={loading} onClick={() => setImportExpanded(expanded => !expanded)}>{importExpanded ? "Collapse import" : "Import again"}</button>
      } />
      <div id="merit-import-body" hidden={!importExpanded}>
      <form className="merit-import-form" onSubmit={fetchUserMerits}>
        <label htmlFor="merit-api-key"><span>Torn API key</span><input id="merit-api-key" type="password" autoComplete="off" spellCheck={false}
          placeholder="Paste a Minimal or Limited key" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={loading} aria-describedby="merit-import-disclosure" /></label>
        <button className="panel-action-button" type="submit" disabled={loading || !apiKey.trim()}><Download size={15} />{loading ? "Fetching merits…" : "Fetch my merits"}</button>
        {loading ? <button type="button" className="panel-action-button secondary" onClick={cancelImport}>Cancel</button> : null}
      </form>
      <p className="merit-help" id="merit-import-disclosure">Uses your key once to read your merits and the merit catalog directly from Torn. The key is cleared after submission, never saved, and never sent to this dashboard’s server. A custom key needs user → merits and torn → merits access.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <p className={importExpanded ? "merit-import-message" : "merit-sr-only"} role="status">{loading ? "Fetching your allocation…" : message}</p>
    </section>

    <section className={`panel merit-summary${available < 0 ? " is-over-budget" : ""}`} aria-label="Merit budget">
      <label htmlFor="merit-budget"><span>Total merits</span><input id="merit-budget" type="number" min={0} max={99999} step={1} value={plan.budget} disabled={loading}
        onChange={event => { setPreview(null); dispatch({ type: "budget", budget: event.target.valueAsNumber }); }} /></label>
      <div><span>{preview ? "Preview allocation" : "Allocated"}</span><strong data-testid="merit-used">{projected}</strong></div>
      <div><span>{available < 0 ? "Over budget" : "Available"}</span><strong data-testid="merit-available">{Math.abs(available)}</strong></div>
      <div className="merit-summary-actions">
        <button type="button" className="panel-action-button secondary" disabled={loading || !changed} onClick={() => { dispatch({ type: "reset" }); setPreview(null); }}><RotateCcw size={12} />{plan.imported ? "Restore imported" : "Reset allocation"}</button>
        <button type="button" className="panel-action-button secondary" disabled={loading || !plan.used} onClick={() => { dispatch({ type: "clear" }); setPreview(null); }}>Clear all</button>
      </div>
    </section>

    <fieldset className="panel merit-planner-panel" disabled={loading}>
      <legend className="merit-sr-only">Merit allocation</legend>
      <div className="merit-list-heading" aria-hidden="true"><span>Upgrade / effect</span><span>Level · 1–10</span><span>Cost</span></div>
      {rows.map(({ definition, index }, rowIndex) => <MeritRow key={definition.key} definition={definition} index={index} level={plan.levels[index]} baseline={plan.baseline[index]}
        sectionStart={rowIndex > 0 && definition.group !== rows[rowIndex - 1].definition.group}
        preview={preview?.index === index ? preview.level : null} onSelect={selectLevel} onPreview={previewLevel} />)}
    </fieldset>
    <span className="merit-sr-only" role="status">Selected allocation: {plan.used} merits. {plan.budget - plan.used >= 0 ? `${plan.budget - plan.used} available` : `${plan.used - plan.budget} over budget`}.</span>
  </div>;
}

const MeritRow = React.memo(function MeritRow({ definition, index, level, baseline, sectionStart, preview, onSelect, onPreview }: {
  definition: MeritDefinition; index: number; level: number; baseline: number; sectionStart: boolean; preview: number | null;
  onSelect: (index: number, level: number) => void; onPreview: (index: number, level: number | null) => void;
}) {
  const firstLevel = React.useRef<HTMLButtonElement>(null);
  const shown = preview ?? level;
  const difference = meritCost(shown) - meritCost(baseline);
  return <div className={`merit-row${sectionStart ? " merit-section-start" : ""}${preview !== null ? " is-preview" : ""}`}>
    <div><h3 id={`merit-name-${definition.key}`}>{definition.name}</h3><p>{meritEffect(definition, shown)}</p></div>
    <div className="merit-allocation"
      onPointerLeave={() => onPreview(index, null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onPreview(index, null); }}>
    <div className="merit-levels" role="radiogroup" aria-labelledby={`merit-name-${definition.key}`}
      onKeyDown={event => {
        const target = event.target as HTMLButtonElement;
        const current = Number(target.dataset.level);
        const next = event.key === "Home" ? 1 : event.key === "End" ? 10 : event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.min(10, current + 1)
          : event.key === "ArrowLeft" || event.key === "ArrowUp" ? Math.max(1, current - 1) : null;
        if (event.key === "Escape") { onPreview(index, null); return; }
        if (next === null || !Number.isInteger(current)) return;
        event.preventDefault();
        (event.currentTarget.children[next - 1] as HTMLButtonElement).focus();
        onSelect(index, next);
      }}>
      {LEVELS.map(value => <button key={value} ref={value === 1 ? firstLevel : undefined} type="button" role="radio" aria-checked={value === level} aria-label={`${definition.name}: level ${value}, ${meritCost(value)} merits`}
        tabIndex={value === Math.max(1, level) ? 0 : -1} data-level={value} className={`${value <= shown ? "filled " : ""}${value === level ? "selected" : ""}`}
        onPointerEnter={event => { if (event.pointerType === "mouse" || event.pointerType === "pen") onPreview(index, value); }}
        onFocus={() => onPreview(index, value)} onClick={() => onSelect(index, value)}>{value}</button>)}
    </div>
    <button type="button" className="merit-reset" disabled={level === 0}
      onPointerEnter={event => { if (level > 0 && (event.pointerType === "mouse" || event.pointerType === "pen")) onPreview(index, 0); }}
      onFocus={() => onPreview(index, 0)} onKeyDown={event => { if (event.key === "Escape") onPreview(index, null); }}
      onClick={() => { firstLevel.current?.focus({ preventScroll: true }); onSelect(index, 0); }}>×</button>
    </div>
    <div className="merit-row-cost"><strong>{meritCost(shown)}</strong>{difference !== 0 ? <span>{difference > 0 ? "+" : ""}{difference} vs original</span> : null}</div>
  </div>;
});
