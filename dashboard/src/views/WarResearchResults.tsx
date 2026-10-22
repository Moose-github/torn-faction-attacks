import { useEffect, useState } from 'react';
import { getJson } from '../api/client';
import type { WarResearchResults, WarResearchResultsResponse } from '../../../shared/rankedResearch';
import { startPolling } from '../utils/polling';
import { ResearchCoveragePanel } from './AdminControls/ResearchEvidence';
import { ResearchFactorPlots } from './AdminControls/ResearchGraphs';
import './AdminControls/rankedWarResearch.css';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export function WarResearchResultsPage() {
  const [result, setResult] = useState<WarResearchResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const poll = startPolling(async ({ signal, isCurrent }) => {
      try {
        const response = await getJson<WarResearchResultsResponse>('/api/war-research/results', true, signal);
        if (isCurrent()) { setResult(response.result); setError(''); }
      } catch (e) {
        if (isCurrent()) setError(e instanceof Error ? e.message : 'Saved results could not be loaded.');
      } finally { if (isCurrent()) setLoading(false); }
    }, { intervalMs: 60000, pauseWhenHidden: true, refreshOnVisible: true });
    return () => poll.stop();
  }, []);
  return <div className="war-research war-research-results">
    <section className="hero-panel compact-hero-panel"><div>
      <p className="eyebrow">Miscellaneous</p><h2>War research results</h2>
      <p>Sample coverage and gross reward patterns from the latest saved analysis. Both starting ranks are Platinum; forfeits are excluded.</p>
      {result && <p><strong>{result.name}</strong> · {result.range.start} – {result.range.end} (UTC) · Analysis saved {result.generated_at.slice(0, 10)}.</p>}
    </div></section>
    {error && <p className="error-panel" role="alert">{error}{result ? ' Showing the previously loaded results.' : ''}</p>}
    {loading ? <p role="status">Loading saved research results…</p> : !result && !error ? <section className="panel"><h3>No saved results yet</h3><p>Results will appear here once an administrator saves an analysis.</p></section> : null}
    {result && <>
      {result.coverage ? <ResearchCoveragePanel coverage={result.coverage} showTopFactions={false}/> : <section className="panel"><h3>Sample coverage</h3><p>This older analysis does not contain coverage information.</p></section>}
      <section className="panel"><h3>Reward values</h3><p>Gross cache values use the saved prices below. Expenses are not deducted. Rewards needing an unknown price are excluded from value comparisons.</p>
        <dl className="research-health-grid">{Object.entries(result.prices).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value === null ? 'Unknown' : money(value)}</dd></div>)}</dl>
      </section>
      <ResearchFactorPlots data={result.combined} whole={true}/>
      <ResearchFactorPlots data={result.faction} whole={false}/>
    </>}
  </div>;
}
