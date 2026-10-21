import React from 'react';
import { getJson, postJson } from '../../api/client';
import type { ResearchAnalysis, ResearchRun, ResearchHealth } from '../../../../shared/rankedResearch';
import { researchPlatinumLabel } from '../../../../shared/rankedResearch';
import './rankedWarResearch.css';
import { ResearchCoveragePanel, ResearchEvidenceCards } from './ResearchEvidence';
import { ResearchGraphPanel } from './ResearchGraphs';
import { ResearchCollectionHealth } from './ResearchCollectionHealth';

const API = '/api/admin/ranked-research';
type ExportPage = { dataset: { id: string; name: string; start: string; end: string; snapshot_token: string }; reports: unknown[]; next: number | null };
function download(name: string, content: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const dollars = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export function RankedWarResearch() {
  const [runs, setRuns] = React.useState<ResearchRun[]>([]);
  const [selected, setSelected] = React.useState('');
  const [analysis, setAnalysis] = React.useState<ResearchAnalysis | null>(null);
  const [health, setHealth] = React.useState<ResearchHealth | null>(null);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ name: 'Platinum reward study', start: '2026-09-01', end: new Date(Date.now() - 86400000).toISOString().slice(0, 10), budget: 5000 });
  const [resumeBudget, setResumeBudget] = React.useState(1000);
  const run = runs.find(r => r.id === selected);
  const load = React.useCallback(async () => {
    const data = await getJson<{ runs: ResearchRun[] }>(API);
    setRuns(data.runs); setSelected(current => current || data.runs[0]?.id || '');
  }, []);
  React.useEffect(() => {
    void load().catch(e => setError(e.message));
    const timer = setInterval(() => void load().catch(e => setError(e.message)), 10000);
    return () => clearInterval(timer);
  }, [load]);
  React.useEffect(() => {
    setAnalysis(null);
    if (!selected) return;
    const controller = new AbortController();
    void getJson<{ analysis: ResearchAnalysis | null }>(`${API}/${selected}/analysis`, true, controller.signal)
      .then(data => setAnalysis(data.analysis)).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [selected]);
  React.useEffect(() => { if (run) setResumeBudget(run.request_limit); }, [run?.id, run?.request_limit]);
  React.useEffect(() => {
    setHealth(null);
    if (!selected) return;
    const controller = new AbortController();
    const refresh = () => void getJson<{ health: ResearchHealth }>(`${API}/${selected}/health`, true, controller.signal)
      .then(data => setHealth(data.health)).catch(e => { if (e.name !== 'AbortError') setHealth(null); });
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [selected]);

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'The operation could not finish.'); }
    finally { setBusy(false); }
  }
  async function exportDataset() {
    let after = 0;
    let page: ExportPage;
    const reports: unknown[] = [];
    do {
      page = await getJson<ExportPage>(`${API}/${selected}/export?after=${after}`);
      reports.push(...page.reports); after = page.next ?? 0;
    } while (page.next !== null);
    download(`war-research-${selected}.json`, { format: 'ranked-research-dataset-v1', dataset: page.dataset, reports });
    setNotice(`Downloaded ${reports.length.toLocaleString()} saved reports. This used no Torn requests.`);
  }
  async function importAnalysis(file: File) {
    if (file.size > 1500000) throw new Error('Choose the compact analysis file, under 1.5 MB.');
    const body = JSON.parse(await file.text());
    await postJson(`${API}/${selected}/analysis`, body);
    const data = await getJson<{ analysis: ResearchAnalysis }>(`${API}/${selected}/analysis`);
    setAnalysis(data.analysis); setNotice('Analysis saved in this dataset.');
  }
  async function exportIssues() {
    let after = 0;
    let page: ResearchHealth;
    const issues: ResearchHealth['issues'] = [];
    do {
      page = (await getJson<{ health: ResearchHealth }>(`${API}/${selected}/health?after=${after}`)).health;
      issues.push(...page.issues); after = page.next_issue ?? 0;
    } while (page.next_issue !== null);
    download(`war-research-${selected}-issues.json`, { run_id: selected, snapshot_token: run?.snapshot_token ?? null, issues });
  }
  return <div className="war-research">
    <section className="panel">
      <p className="war-research-eyebrow">Admin research workspace</p>
      <h2>What makes a ranked war more rewarding?</h2>
      <p>Collect a fixed historical sample, freeze it, then compare factors associated with the combined war pot and individual faction rewards. Both starting ranks must be Platinum. Forfeits and expenses are excluded.</p>
      <div className="war-research-steps"><span>1. Collect a sample</span><span>2. Freeze &amp; analyse</span><span>3. Keep the findings</span></div>
      <p className="panel-description">Collection runs only after you start it and stops at its request budget or the end of the date range. It continues with this page closed. Viewing saved data makes no Torn requests.</p>
    </section>
    {error && <p role="alert" className="error-panel">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="war-research-grid">
      <section className="panel">
        <h3>New dataset</h3>
        <form className="admin-form" onSubmit={event => { event.preventDefault(); void act(async () => {
          const data = await postJson<{ id: string }>(API, form); setSelected(data.id); setNotice('Dataset created. Start collection when ready.');
        }); }}>
          <label className="admin-form-wide">Name<input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
          <label>From (UTC)<input type="date" required min="2025-05-21" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}/></label>
          <label>Through (UTC)<input type="date" required max={new Date(Date.now() - 86400000).toISOString().slice(0, 10)} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}/></label>
          <label className="admin-form-wide">Total request budget<input type="number" min={1} max={50000} required value={form.budget} onChange={e => setForm({ ...form, budget: Number(e.target.value) })}/></label>
          <p className="panel-description admin-form-wide">The budget includes discovery pages and failed requests. Starting ranks are only available in detailed reports, so some calls will find wars outside Platinum.</p>
          <p className="panel-description admin-form-wide">5,000 calls cover roughly four hours at one owner’s maximum pace. Actual collection can be slower, or faster with multiple owners. This is a call budget, not a target number of eligible wars.</p>
          <button className="admin-button primary" disabled={busy}>Create dataset</button>
        </form>
      </section>
      <section className="panel">
        <h3>Saved datasets</h3>
        <label>Dataset<select className="war-research-select" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
          {!runs.length && <option value="">No datasets yet</option>}
          {runs.map(r => <option key={r.id} value={r.id}>{r.name} · {r.status}</option>)}
        </select></label>
        {run && <>
          <p><strong>{run.start_date} – {run.end_date}</strong> · {run.status}</p>
          <div className="war-research-metrics">
            <div><strong>{(run.reports ?? 0).toLocaleString()}</strong><span>reports saved</span></div>
            <div><strong>{(run.eligible ?? 0).toLocaleString()}</strong><span>Platinum wars</span></div>
            <div><strong>{run.requests.toLocaleString()} / {run.request_limit.toLocaleString()}</strong><span>requests used / budget</span></div>
          </div>
          <p role="status">{run.message}</p>
          <p className="panel-description">{run.pending ?? 0} discovered reports still to collect.</p>
          <ResearchCollectionHealth run={run} health={health} busy={busy} onDownload={() => void act(exportIssues)}/>
          {run.status !== 'frozen' && <div className="admin-form">
            <label className="admin-form-wide">Total budget for this run<input type="number" min={run.request_limit} max={50000} value={resumeBudget} onChange={e => setResumeBudget(Number(e.target.value))}/></label>
            <button className="admin-button primary" disabled={busy || run.status === 'running' || run.status === 'complete'} onClick={() => void act(async () => { await postJson(`${API}/${selected}/resume`, { budget: resumeBudget }); })}>Start / resume collection</button>
            <button className="admin-button" disabled={busy || run.status !== 'running'} onClick={() => void act(async () => { await postJson(`${API}/${selected}/pause`); })}>Pause</button>
            <button className="admin-button" disabled={busy || run.status === 'running'} onClick={() => void act(async () => { await postJson(`${API}/${selected}/freeze`); })}>Freeze saved dataset</button>
            <p className="panel-description admin-form-wide">Freezing keeps the reports already saved and excludes any still pending. It is permanent; future collections use a new dataset.</p>
          </div>}
          {run.status === 'frozen' && <div className="admin-form">
            <button className="admin-button primary" disabled={busy} onClick={() => void act(exportDataset)}>Download dataset for analysis</button>
            <label className="admin-form-wide">Upload finished analysis<input type="file" accept=".json" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void act(() => importAnalysis(file)); }}/></label>
            <p className="panel-description admin-form-wide">The analysis runs separately on the saved dataset. Upload its result here to keep the findings with their original sample. Repeating it uses no Torn requests.</p>
          </div>}
        </>}
      </section>
    </div>
    <section className="panel">
      <h3>API pool use</h3>
      <p>Collection uses keys opted into <strong>Enemy scouting</strong> in Settings. Research uses up to 20 requests per rolling minute per known key owner, shares that allowance across their keys, and waits when this dashboard is already using their capacity. Failed requests count too.</p>
      <p className="panel-description">Other apps also share Torn’s account limit and are not visible here. Research keeps spare capacity for them and for live dashboard features. No keys are sent to your browser.</p>
    </section>
    {analysis?.coverage ? <ResearchCoveragePanel coverage={analysis.coverage}/> : analysis && <section className="panel"><h3>Sample coverage</h3><p>Rerun the saved export to add coverage and evidence cards. Older exports may not contain collection completeness information.</p></section>}
    {analysis ? <ResearchResults result={analysis}/> : <section className="panel"><h3>Findings</h3><p>No analysis saved for this dataset yet. Freeze and download a sample, then upload its analysis.</p></section>}
  </div>;
}

function ResearchResults({ result: r }: { result: ResearchAnalysis }) {
  const [view, setView] = React.useState<'whole' | 'faction'>('whole');
  const whole = view === 'whole' ? r.whole_war : undefined;
  const model = whole?.model ?? r.model;
  const comparisons = whole ? whole.comparisons : r.comparisons;
  return <section className="panel">
    <p className="war-research-eyebrow">Saved findings · {r.generated_at.slice(0, 10)}</p>
    <div className="war-research-steps" role="group" aria-label="Reward view">
      <button className="admin-button" aria-pressed={!!whole} disabled={!r.whole_war} onClick={() => setView('whole')}>Combined war pot</button>
      <button className="admin-button" aria-pressed={!whole} onClick={() => setView('faction')}>Individual faction</button>
    </div>
    {!r.whole_war && <p>This older analysis contains faction results only. Rerun the saved dataset to add whole-war results; no new collection is needed.</p>}
    <h2>{whole ? 'Factors associated with the combined war pot' : 'Factors associated with individual faction rewards'}</h2>
    <p>{r.scope}</p>
    <p>{r.eligible_wars.toLocaleString()} eligible wars · {r.distinct_factions.toLocaleString()} factions · {(whole?.model_observations ?? r.model_observations).toLocaleString()} {whole ? 'wars' : 'faction observations'} usable for adjusted analysis</p>
    {whole && <>
      <p>Both factions’ rewards are added together, with each war counted once. A pot is valued only when all rewards on both sides are priced.</p>
      <div className="war-research-metrics">
        <div><strong>{whole.valued_wars.toLocaleString()}</strong><span>fully priced wars</span></div>
        <div><strong>{whole.median_value === null ? 'Not available' : dollars(whole.median_value)}</strong><span>median combined pot</span></div>
        <div><strong>{whole.mean_value === null ? 'Not available' : dollars(whole.mean_value)}</strong><span>mean combined pot</span></div>
      </div>
    </>}
    <ResearchGraphPanel key={whole ? 'whole' : 'faction'} data={whole ? whole.graphs : r.graphs} cards={comparisons} whole={!!whole}/>
    {comparisons ? <ResearchEvidenceCards cards={comparisons} whole={!!whole}/> : !model.available ? <p>{model.reason}</p> : <div className="war-research-grid">{model.effects?.map(e => <article className="war-research-factor" key={e.field}>
      <h3>{e.label}</h3>{!e.available ? <p>{e.reason}</p> : <>
        <p><strong>{e.status}</strong></p><div className="war-research-effect">{dollars((e.effect_m ?? 0) * 1e6)}</div>
        <p>Adjusted difference comparing {e.range?.[0].toFixed(2)} with {e.range?.[1].toFixed(2)}.</p>
        <p>Approximate 95% interval: {e.interval_m ? `${dollars(e.interval_m[0] * 1e6)} to ${dollars(e.interval_m[1] * 1e6)}` : 'not estimable'}</p>
        <p>{e.cautions?.join(' ')}</p>
      </>}
    </article>)}</div>}
    <h3>{whole ? 'Observed combined rewards' : 'Observed faction rewards'}</h3><p className="panel-description">These summaries do not isolate individual factors. Values use one stated price table, rather than historical sale prices.</p>
    {whole ? <div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>Winner starting division</th><th>Loser starting division</th><th>Wars</th><th>Median pot</th><th>Mean pot</th></tr></thead>
      <tbody>{whole.summaries.map(s => <tr key={`${s.winner_division}-${s.loser_division}`}><td>{researchPlatinumLabel(s.winner_division)}</td><td>{researchPlatinumLabel(s.loser_division)}</td><td>{s.n}</td><td>{dollars(s.median_value)}</td><td>{dollars(s.mean_value)}</td></tr>)}</tbody></table></div>
      : <div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>Division</th><th>Outcome</th><th>Observations</th><th>Median</th><th>Mean</th></tr></thead>
      <tbody>{r.summaries.map(s => <tr key={`${s.division}-${s.won}`}><td>{researchPlatinumLabel(s.division)}</td><td>{s.won ? 'Win' : 'Loss'}</td><td>{s.n}</td><td>{dollars(s.median_value)}</td><td>{dollars(s.mean_value)}</td></tr>)}</tbody></table></div>
    }
    <details><summary>Price assumptions, method and limitations</summary>
      <p>{model.method}</p><ul>{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      <ul>{Object.entries(r.prices).map(([name, value]) => <li key={name}>{name}: {value === null ? 'Not priced' : dollars(value)}</li>)}</ul>
    </details>
    <p className="panel-description">Associations do not prove cause and effect. Results do not establish a hit target, participation cap, or scaling rule for other ranks.</p>
  </section>;
}
