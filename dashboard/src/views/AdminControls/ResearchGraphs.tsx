import { useState } from 'react';
import type { ResearchComparison, ResearchGraphs, ResearchFactorGraphs } from '../../../../shared/rankedResearch';
import { rewardPerMemberGraph } from '../../utils/researchRewardPerMember';

const compact = (v: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const dollars = (v: number) => `$${compact(v)}`;
const fullMoney = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
const ticks = (lo: number, hi: number) => Array.from({ length: 5 }, (_, i) => lo + (hi - lo) * i / 4);
const scale = (lo: number, hi: number, start: number, end: number) => (v: number) => start + (v - lo) / (hi - lo || 1) * (end - start);
const names: Record<string, string> = { attacks: 'Reported attacks', score: 'War score', participation_rate: 'Participation', top20_attack_share: 'Attack concentration', duration_hours: 'Duration', listed_members: 'Roster size', opponent_listed_members: 'Opponent roster', opponent_score: 'Opponent score', attack_balance: 'Attack balance', score_balance: 'Score balance', roster_balance: 'Roster balance' };

function Scatter({ data, index, medians, whole, perMember = false }: { data: ResearchFactorGraphs; index: number; medians: boolean; whole: boolean; perMember?: boolean }) {
  const f = data.factors[index];
  const rewardLabel = perMember ? 'Gross reward per listed member' : 'Gross reward';
  const lo = f.range[0], hi = f.range[1] === lo ? lo + 1 : f.range[1];
  const ymax = data.value_range[1] || 1;
  const x = scale(lo, hi, 84, 670), y = scale(0, ymax, 340, 35);
  return <div className="research-plot-scroll" tabIndex={0} aria-label="Scrollable factor plot"><svg viewBox="0 0 710 410" role="img" aria-label={`${f.label} versus ${rewardLabel.toLowerCase()} (${whole ? 'combined war' : 'individual faction'})`}>
    <title>{f.label} versus {rewardLabel.toLowerCase()}. {data.points.length} dots of {data.observations} observations.{medians && ' Grouped medians use all observations.'}</title>
    <text x={84} y={18}>{rewardLabel} ($)</text>
    {ticks(0, ymax).map(v => <g key={v}><line className="research-gridline" x1={84} x2={670} y1={y(v)} y2={y(v)}/><text x={74} y={y(v) + 4} textAnchor="end">{dollars(v)}</text></g>)}
    {ticks(lo, hi).map(v => <g key={v}><line className="research-gridline" x1={x(v)} x2={x(v)} y1={35} y2={340}/><text x={x(v)} y={363} textAnchor="middle">{compact(v)}</text></g>)}
    {data.points.map(p => <circle className="research-dot" key={`${p.war_id}-${p.faction_id}`} cx={x(p.values[index])} cy={y(p.value)} r={3.5}><title>{`War ${p.war_id} · ${whole ? 'Winner' : 'Faction'} ${p.faction_id}\n${f.label}: ${p.values[index]} ${f.unit}\n${rewardLabel}: ${fullMoney(p.value)}`}</title></circle>)}
    {medians && f.medians.map((m, i) => <rect className="research-median" key={i} x={x(m.x)-5} y={y(m.y)-5} width={10} height={10}><title>{`Group median: ${m.x} ${f.unit}, ${fullMoney(m.y)} · n=${m.n}`}</title></rect>)}
    <text x={377} y={396} textAnchor="middle">{f.label} ({f.unit})</text>
  </svg></div>;
}

function RewardPerMemberPlot({ data, whole }: { data: ResearchFactorGraphs; whole: boolean }) {
  const graph = rewardPerMemberGraph(data);
  return <article className="research-per-member-plot">
    <h4>Gross reward per listed member vs war score</h4>
    <p>{whole ? 'Both factions’ combined gross rewards divided by their combined listed roster size, plotted against their combined war score.' : 'Each faction’s gross reward divided by its own listed roster size, plotted against its own war score.'} Roster size includes listed members who made no attacks. This is a size-normalised reward value, not an actual member payout.</p>
    {!graph ? <p>This saved analysis lacks the score or roster data needed for this graph.</p> : !graph.points.length ? <p>No observations have a valid score, reward value and positive roster size.</p> : <>
      <p><span className="research-dot-key">●</span> {graph.points.length.toLocaleString()} {whole ? 'war' : 'faction'} observations from {graph.wars.toLocaleString()} wars. {data.points.length < data.observations ? `Uses the existing repeatable dot sample from ${data.observations.toLocaleString()} usable observations; axis ranges reflect the displayed sample and may omit extremes.` : 'Uses every saved graph observation with a valid roster size.'}</p>
      {graph.points.length < data.points.length && <p>{(data.points.length - graph.points.length).toLocaleString()} observations omitted because their score, reward or roster size is invalid.</p>}
      <Scatter data={graph} index={0} medians={false} whole={whole} perMember/>
    </>}
  </article>;
}

export function ResearchFactorPlots({ data, whole }: { data?: ResearchFactorGraphs; whole: boolean }) {
  // Update labels from existing saved analyses without requiring reanalysis.
  data = data && { ...data, factors: data.factors.map(factor => factor.field === 'top20_attack_share'
    ? { ...factor, label: 'Attack share from busiest 20%' } : factor) };
  const descriptions: Record<string, string> = {
    participation_rate: 'Share of listed members who made at least one reported attack.',
    top20_attack_share: whole ? 'Share of all attacks made by each faction’s busiest 20% of listed members, combined.' : 'Share of attacks made by the busiest 20% of listed members.',
    attack_balance: 'Balance of reported attacks between the two factions: the lower faction attack total divided by both factions’ combined total. 0.5 means both factions made the same number of attacks; values closer to 0 mean one faction made most of the attacks.',
    score_balance: 'The smaller faction score divided by both scores combined. 0.5 means evenly shared score.',
  };
  return <section className="panel research-results-plots">
    <h3>{whole ? 'Combined war rewards' : 'Individual faction rewards'}</h3>
    <p>{whole ? 'Gross rewards gained by both factions, counted once per war.' : 'Gross rewards gained by each faction, with each faction shown separately.'}</p>
    {!data ? <p>No saved factor graphs are available for this view yet.</p> : !data.observations ? <p>No fully priced observations pass the member-total checks for this view.</p> : <>
      <p>{data.observations.toLocaleString()} fully priced observations from {data.wars.toLocaleString()} wars. <span className="research-dot-key">●</span> {data.points.length.toLocaleString()} {data.points.length < data.observations ? 'repeatably sampled' : 'individual'} observations per graph. <span className="research-median-key">■</span> Grouped medians use every usable observation.</p>
      {data.points.length < data.observations && <p>The dot sample may omit extremes; axis ranges include the full sample.</p>}
      <p>Observed patterns can reflect several factors together. They do not establish a causal effect or a reward target.</p>
      <p className="research-scroll-hint">Scroll graphs horizontally to see all values.</p>
      {data.factors.map((factor, index) => <article key={factor.field}>
        <h4>{factor.field === 'attack_balance' ? 'Attack balance between the two factions' : factor.label}</h4>
        {descriptions[factor.field] && <p>{descriptions[factor.field]}</p>}
        <Scatter data={data} index={index} medians={true} whole={whole}/>
      </article>)}
      <RewardPerMemberPlot data={data} whole={whole}/>
    </>}
  </section>;
}

function Distributions({ data, whole }: { data: ResearchGraphs; whole: boolean }) {
  const max = data.value_range[1] || 1, x = scale(0, max, 180, 680);
  const bottom = 35 + data.distributions.length * 42;
  return <>
    <p>{whole ? 'Labels show winner / loser starting Platinum divisions.' : 'Labels show own / opponent starting Platinum divisions and this faction’s outcome.'} Box: middle 50%; line inside: median; whiskers: minimum and maximum. These show reward spread, not confidence intervals.</p>
    <div className="research-plot-scroll" tabIndex={0} aria-label="Scrollable reward distributions"><svg viewBox={`0 0 760 ${bottom + 60}`} role="img" aria-label="Gross reward distributions by Platinum division pairing">
      <title>All {data.observations} observations; {data.wars} distinct wars. Each row shows minimum, quartiles, median and maximum.</title>
      {ticks(0, max).map(v => <g key={v}><line className="research-gridline" x1={x(v)} x2={x(v)} y1={15} y2={bottom}/><text x={x(v)} y={bottom+22} textAnchor="middle">{dollars(v)}</text></g>)}
      {data.distributions.map((d, i) => { const yy = 35+i*42, [min, q1, median, q3, maxValue] = d.five_number; return <g key={d.label}>
        <title>{`${d.label}: n=${d.n}, ${d.wars} wars. Min ${fullMoney(min)}, Q1 ${fullMoney(q1)}, median ${fullMoney(median)}, Q3 ${fullMoney(q3)}, max ${fullMoney(maxValue)}`}</title>
        <text x={170} y={yy+4} textAnchor="end">{d.label}</text><line className="research-whisker" x1={x(min)} x2={x(maxValue)} y1={yy} y2={yy}/>
        {[min,maxValue].map((v,j) => <line key={j} className="research-whisker" x1={x(v)} x2={x(v)} y1={yy-6} y2={yy+6}/>)}
        <rect className="research-box" x={x(q1)} y={yy-10} width={Math.max(1,x(q3)-x(q1))} height={20}/>
        <line className="research-whisker" x1={x(median)} x2={x(median)} y1={yy-10} y2={yy+10}/><text x={695} y={yy+4}>n={d.n}</text>
      </g>; })}
      <text x={430} y={bottom+48} textAnchor="middle">Gross reward ($)</text>
    </svg></div>
    <details><summary>Distribution values</summary><div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>Pairing</th><th>Observations</th><th>Wars</th><th>Minimum</th><th>25th percentile</th><th>Median</th><th>75th percentile</th><th>Maximum</th></tr></thead><tbody>{data.distributions.map(d => <tr key={d.label}><td>{d.label}</td><td>{d.n}</td><td>{d.wars}</td>{d.five_number.map((v,i) => <td key={i}>{fullMoney(v)}</td>)}</tr>)}</tbody></table></div></details>
  </>;
}

function Adjusted({ cards }: { cards: ResearchComparison[] }) {
  const estimated = cards.filter(c => c.adjusted);
  if (!estimated.length) return <p>No adjusted estimates are available for this sample. The evidence cards explain the data requirements.</p>;
  const values = estimated.flatMap(c => [c.adjusted!.difference, ...(c.adjusted!.interval ?? [])]);
  const min = Math.min(0,...values), max = Math.max(0,...values), padding = (max-min || 1)*.06;
  const lo = min-padding, hi = max+padding, x = scale(lo,hi,190,660), bottom=35+estimated.length*48;
  return <>
    <p>Dots show adjusted differences from the 25th to the 75th percentile of each factor. Lines show approximate 95% uncertainty intervals. The dashed line is zero association. These comparisons have different input ranges and do not rank achievable interventions. See the cards for sample counts, stability checks and limitations.</p>
    <div className="research-plot-scroll" tabIndex={0} aria-label="Scrollable adjusted associations"><svg viewBox={`0 0 770 ${bottom+60}`} role="img" aria-label="Adjusted associations with gross rewards and uncertainty intervals">
      <title>Adjusted reward differences, with approximate 95% intervals. Intervals are not adjusted for multiple comparisons.</title>
      {ticks(lo,hi).map(v => <g key={v}><line className="research-gridline" x1={x(v)} x2={x(v)} y1={15} y2={bottom}/><text x={x(v)} y={bottom+22} textAnchor="middle">{dollars(v)}</text></g>)}
      <line className="research-zero" x1={x(0)} x2={x(0)} y1={15} y2={bottom}/>
      {estimated.map((c,i) => { const a=c.adjusted!, yy=35+i*48; return <g key={c.field}>
        <title>{`${c.question}\n${c.status} · ${c.wars} wars · ${c.factions} factions\n${a.range[0]} to ${a.range[1]} ${c.unit}\n${fullMoney(a.difference)}; interval ${a.interval ? a.interval.map(fullMoney).join(' to ') : 'not estimable'}`}</title>
        <text x={180} y={yy+4} textAnchor="end">{names[c.field] ?? c.field}</text>
        {a.interval && <><line className="research-whisker" x1={x(a.interval[0])} x2={x(a.interval[1])} y1={yy} y2={yy}/>{a.interval.map((v,j)=><line key={j} className="research-whisker" x1={x(v)} x2={x(v)} y1={yy-5} y2={yy+5}/>)}</>}
        <circle className="research-estimate" cx={x(a.difference)} cy={yy} r={5}/><text x={675} y={yy+4}>{a.interval ? '' : 'No interval'}</text>
      </g>; })}
      <text x={425} y={bottom+48} textAnchor="middle">Adjusted gross reward difference ($)</text>
    </svg></div>
    <details><summary>Adjusted chart values</summary><div className="stock-status-table-wrap"><table className="stock-status-table"><thead><tr><th>Factor</th><th>Input comparison</th><th>Difference</th><th>95% interval</th><th>Evidence</th><th>Wars</th></tr></thead><tbody>{estimated.map(c => <tr key={c.field}><td>{names[c.field] ?? c.field}</td><td>{c.adjusted!.range.map(v=>v.toFixed(2)).join(' → ')} {c.unit}</td><td>{fullMoney(c.adjusted!.difference)}</td><td>{c.adjusted!.interval?.map(fullMoney).join(' to ') ?? 'Not estimable'}</td><td>{c.status}</td><td>{c.wars}</td></tr>)}</tbody></table></div></details>
  </>;
}

function ScoreBands({ card }: { card?: ResearchComparison }) {
  if (!card?.score_bands) return <p>Reanalyse this collection to add comparisons across fixed score ranges.</p>;
  const money = (value: number | null) => value === null ? '—' : dollars(value);
  return <section>
    <h4>Rewards by score range</h4>
    <p>Fixed ranges help inspect where observed rewards rise or flatten. All usable observations are included. Ranges with fewer than 20 distinct wars are marked sparse. The middle 50% shows reward spread within a range, rather than uncertainty about its median.</p>
    <div className="stock-status-table-wrap"><table className="stock-status-table"><caption>These are unadjusted summaries. Ranges were not fitted to find a cutoff; differences can reflect other factors. They do not establish a plateau or score target.</caption><thead><tr><th>War score</th><th>Observations</th><th>Distinct wars</th><th>Median reward</th><th>Mean reward</th><th>Middle 50% of rewards</th><th>Coverage</th></tr></thead><tbody>{card.score_bands.map(b => <tr key={b.low}>
      <td>{b.low.toLocaleString()}{b.high === null ? '+' : ` to < ${b.high.toLocaleString()}`}</td><td>{b.n}</td><td>{b.wars}</td><td>{money(b.median_value)}</td><td>{money(b.mean_value)}</td><td>{b.middle_half?.map(dollars).join(' – ') ?? '—'}</td><td>{b.wars === 0 ? 'No observations' : b.wars < 20 ? 'Sparse' : '20+ wars'}</td>
    </tr>)}</tbody></table></div>
  </section>;
}

export function ResearchGraphPanel({ data, cards = [], whole }: { data?: ResearchGraphs; cards?: ResearchComparison[]; whole: boolean }) {
  const [view, setView] = useState<'factors'|'perMember'|'divisions'|'adjusted'>('factors');
  const [field, setField] = useState('attacks');
  const [medians, setMedians] = useState(true);
  const index = Math.max(0, data?.factors.findIndex(f=>f.field===field) ?? 0);
  return <section className="war-research-graphs">
    <h3>Reward graphs</h3>
    <div className="war-research-steps" role="group" aria-label="Graph type">{(['factors','perMember','divisions','adjusted'] as const).map(v => <button key={v} className="admin-button" aria-pressed={view===v} onClick={()=>setView(v)}>{v==='factors' ? 'Factors vs rewards' : v==='perMember' ? 'Reward per member vs score' : v==='divisions' ? 'Division distributions' : 'Adjusted associations'}</button>)}</div>
    <p>Gross {whole ? 'combined pot' : 'individual faction reward'} value. {data ? `${data.observations.toLocaleString()} fully priced, audited observations from ${data.wars.toLocaleString()} wars.` : 'Reanalyse the saved collection to add observed plots.'} Observed plots do not isolate causal effects.</p>
    <p className="research-scroll-hint">Scroll charts horizontally to see all values. Expand the values below a chart for its numerical summary.</p>
    {view==='adjusted' ? <Adjusted cards={cards}/> : !data ? null : !data.observations ? <p>No fully priced observations pass the member-total checks. Graphs will appear when usable data is available.</p> : view==='divisions' ? <Distributions data={data} whole={whole}/> : view==='perMember' ? <RewardPerMemberPlot data={data} whole={whole}/> : <>
      <div className="research-plot-controls"><label>Factor<select value={data.factors[index].field} onChange={e=>setField(e.target.value)}>{data.factors.map(f=><option key={f.field} value={f.field}>{f.label}</option>)}</select></label><label><input type="checkbox" checked={medians} onChange={e=>setMedians(e.target.checked)}/> Show grouped medians</label></div>
      <p><span className="research-dot-key">●</span> {data.points.length.toLocaleString()} {data.points.length<data.observations ? 'repeatably sampled' : 'individual'} observations shown. {data.points.length<data.observations && 'This dot sample may omit extremes; axis ranges include the full sample. '}<span className="research-median-key">■</span> Grouped medians use all {data.observations.toLocaleString()} observations. Hover over a mark for its values.</p>
      <Scatter data={data} index={index} medians={medians} whole={whole}/>
      <details><summary>Grouped median values</summary><div className="stock-status-table-wrap"><table className="stock-status-table"><caption>Quartile groups keep tied values together. Markers describe observations, not a fitted trend or payout forecast.</caption><thead><tr><th>Median {data.factors[index].label.toLowerCase()}</th><th>Median gross reward</th><th>Observations</th></tr></thead><tbody>{data.factors[index].medians.map((m,i)=><tr key={i}><td>{m.x.toFixed(2)} {data.factors[index].unit}</td><td>{fullMoney(m.y)}</td><td>{m.n}</td></tr>)}</tbody></table></div></details>
      {data.factors[index].field === 'score' && <ScoreBands card={cards.find(c => c.field === 'score')}/>}
    </>}
  </section>;
}
