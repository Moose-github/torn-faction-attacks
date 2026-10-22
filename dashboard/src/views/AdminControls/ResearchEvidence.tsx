import type { ResearchComparison, ResearchCoverage } from '../../../../shared/rankedResearch';
import type { ReactNode } from 'react';
import { researchPlatinumLabel } from '../../../../shared/rankedResearch';

const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const percent = (v: number | null) => v === null ? 'not defined for a zero baseline' : `${v.toFixed(1)}%`;

function CoverageDetail({ title, displayOnly, children }: { title: string; displayOnly: boolean; children: ReactNode }) {
  return displayOnly ? <section><h4>{title}</h4>{children}</section> : <details><summary>{title}</summary>{children}</details>;
}

export function ResearchCoveragePanel({ coverage: c, displayOnly = false }: { coverage: ResearchCoverage; displayOnly?: boolean }) {
  const m = c.collection;
  const complete = m?.discovery_done && m.pending_reports === 0;
  return <section className="panel">
    <h3>Sample coverage</h3>
    <p><strong>{!m ? 'Collection completeness unknown' : complete ? 'Discovery and report collection completed' : 'Partial collection'}</strong></p>
    {m && <p>{m.saved_reports.toLocaleString()} of {m.discovered_wars.toLocaleString()} discovered completed-war reports saved · {m.pending_reports.toLocaleString()} pending at freeze · discovery {m.discovery_done ? 'finished' : 'unfinished'}.</p>}
    <div className="war-research-metrics">
      <div><strong>{c.saved_reports.toLocaleString()}</strong><span>saved reports, all ranks</span></div>
      <div><strong>{c.eligible_wars.toLocaleString()}</strong><span>eligible Platinum wars</span></div>
      <div><strong>{c.valued_wars.toLocaleString()}</strong><span>fully priced combined pots</span></div>
      <div><strong>{c.model_wars.toLocaleString()}</strong><span>wars passing pricing and total checks</span></div>
    </div>
    <p>{c.distinct_factions.toLocaleString()} distinct eligible factions. Saved war start dates: {c.first_saved ?? 'none'} to {c.last_saved ?? 'none'}.</p>
    <ul>{c.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    <CoverageDetail title="Weekly coverage" displayOnly={displayOnly}>
      <div className="stock-status-table-wrap"><table className="stock-status-table"><caption>Counts by war start date; partial boundary weeks are included.</caption><thead><tr><th>UTC dates</th><th>Saved</th><th>Eligible</th><th>Fully priced</th><th>Eligible factions</th></tr></thead>
        <tbody>{c.weeks.map(w => <tr key={w.start}><td>{w.start} – {w.end}</td><td>{w.saved}</td><td>{w.eligible}</td><td>{w.valued}</td><td>{w.factions}</td></tr>)}</tbody></table></div>
    </CoverageDetail>
    <div className="war-research-grid">
      <CoverageDetail title="Starting division coverage" displayOnly={displayOnly}><div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>Winner</th><th>Loser</th><th>Eligible wars</th></tr></thead><tbody>{c.division_pairs.map(p => <tr key={`${p.winner_division}-${p.loser_division}`}><td>{researchPlatinumLabel(p.winner_division)}</td><td>{researchPlatinumLabel(p.loser_division)}</td><td>{p.wars}</td></tr>)}</tbody></table></div></CoverageDetail>
      <CoverageDetail title="Listed roster coverage" displayOnly={displayOnly}><div className="stock-status-table-wrap"><table className="stock-status-table"><caption>Each faction is counted once per eligible war; a war can appear in two size groups.</caption><thead><tr><th>Faction roster</th><th>Observations</th><th>Wars</th><th>Factions</th></tr></thead><tbody>{c.rosters.map(r => <tr key={r.label}><td>{r.label}</td><td>{r.observations}</td><td>{r.wars}</td><td>{r.factions}</td></tr>)}</tbody></table></div></CoverageDetail>
    </div>
    <CoverageDetail title="Most represented factions" displayOnly={displayOnly}><ul>{c.top_factions.map(f => <li key={f.id}>{f.name} [{f.id}]: {f.wars} eligible wars</li>)}</ul></CoverageDetail>
  </section>;
}

export function ResearchEvidenceCards({ cards, whole }: { cards: ResearchComparison[]; whole: boolean }) {
  return <>
    <h3>Factor comparisons and evidence</h3>
    <p>Observed trends describe how rewards vary across the saved wars. Adjusted associations account for the other model factors. They use the same fully priced sample with consistent member totals. Outcomes are gross {whole ? 'combined pot' : 'faction reward'} values. These exploratory findings do not establish a causal effect, target, or plateau; intervals are not adjusted for testing multiple factors.</p>
    <div className="war-research-grid">{cards.map(c => <article className="war-research-factor" key={c.field}>
      <h4>{c.question}</h4>
      <p>{c.observations.toLocaleString()} {whole ? 'war' : 'faction'} observations · {c.wars.toLocaleString()} wars · {c.factions.toLocaleString()} factions</p>
      {c.observed ? <><p className="war-research-evidence-status">Observed: {c.observed.status}</p><details><summary>How the observed trend is described</summary><p>{c.observed.explanation}</p></details></> : <p>Reanalyse this collection to add a separate observed-trend assessment and score-range comparisons.</p>}
      {c.observed_difference !== null && <p>Observed last-group minus first-group mean: <strong>{money(c.observed_difference)}</strong> ({percent(c.observed_percent)} relative to the first group).</p>}
      <details><summary>Inspect observed groups ({c.groups.length})</summary>
        {c.groups.length ? <div className="stock-status-table-wrap"><table className="stock-status-table"><caption>{c.unit}; ties stay together, so group sizes may differ.</caption><thead><tr><th>Group</th><th>Observations</th><th>Wars</th><th>Factions</th><th>Mean</th><th>Median</th></tr></thead><tbody>{c.groups.map(g => <tr key={g.label}><td>{g.label}</td><td>{g.n}</td><td>{g.wars}</td><td>{g.factions}</td><td>{money(g.mean_value)}</td><td>{money(g.median_value)}</td></tr>)}</tbody></table></div> : <p>No priced observations pass the member-total checks.</p>}
      </details>
      <p className="war-research-evidence-status">Adjusted: {c.status}</p>
      {c.adjusted && <>
        <div className="war-research-effect">{money(c.adjusted.difference)}</div>
        <p>Adjusted difference: {c.adjusted.range[0].toFixed(2)} → {c.adjusted.range[1].toFixed(2)} {c.unit}.</p>
        <p>{percent(c.adjusted.percent_of_mean)} of this sample’s mean reward.</p>
        <p>Approximate 95% interval: {c.adjusted.interval ? `${money(c.adjusted.interval[0])} to ${money(c.adjusted.interval[1])}` : 'not estimable'}.</p>
        <dl className="war-research-checks"><dt>Direction across chronological halves</dt><dd>{c.adjusted.stable_halves === null ? 'Not estimable' : c.adjusted.stable_halves ? 'Consistent' : 'Not consistent'}</dd><dt>Removing the most represented faction</dt><dd>{c.adjusted.sensitive_to_top_faction === null ? 'Not estimable' : c.adjusted.sensitive_to_top_faction ? 'Direction changes' : 'Direction retained'}</dd></dl>
        {c.adjusted.overlap_vif !== undefined && <p>Overlap with other factors: <strong>{c.adjusted.overlap_vif >= 10 ? 'High' : 'Below the high-overlap threshold'}</strong> (VIF {c.adjusted.overlap_vif.toFixed(2)}; flagged at 10). This concerns how well the model can separate this factor’s contribution.</p>}
      </>}
      <p>{c.explanation}</p>
      <details><summary>Evidence limitations</summary><ul>{c.cautions.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
    </article>)}</div>
  </>;
}
