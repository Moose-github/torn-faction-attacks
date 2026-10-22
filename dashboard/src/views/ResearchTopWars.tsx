import { Fragment, useState } from 'react';
import type { ResearchTopFaction, ResearchTopWars } from '../../../shared/rankedResearch';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const stats: { label: string; value: (f: ResearchTopFaction) => string }[] = [
  { label: 'Starting Platinum division', value: f => f.rank_before },
  { label: 'Gross reward value', value: f => money(f.gross_value) },
  { label: 'Reported attacks', value: f => number(f.attacks) },
  { label: 'War score', value: f => number(f.score) },
  { label: 'Listed members', value: f => number(f.listed_members) },
  { label: 'Participation', value: f => percent(f.participation_rate) },
  { label: 'Attack share from busiest 20%', value: f => percent(f.top20_attack_share) },
];

export function ResearchTopWarsPanel({ data }: { data?: ResearchTopWars }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  return <section className="panel research-top-wars">
    <h3>Top 5 wars by gross reward value</h3>
    <p>Highest combined gross rewards in this sample, using the saved cache prices. Expenses are not deducted; these examples do not establish which factors caused the larger rewards.</p>
    {!data ? <p>Top war results are not available yet.</p> : !data.wars.length ? <p>No eligible wars have fully priced rewards for both factions.</p> : <>
      <p>Ranked across all {data.valued_wars.toLocaleString()} fully priced eligible wars, including wars omitted from the graphs. Equal rewards are ordered by war ID.</p>
      <p className="research-scroll-hint">Scroll the table horizontally to see all rewards and open each war’s stats.</p>
      <div className="stock-status-table-wrap" tabIndex={0} aria-label="Scrollable top wars table"><table className="stock-status-table">
        <thead><tr><th scope="col">Rank</th><th scope="col">Factions</th><th scope="col">Combined reward</th><th scope="col">Winner reward</th><th scope="col">Loser reward</th><th scope="col">Duration</th><th scope="col">Breakdown</th></tr></thead>
        <tbody>{data.wars.map((war, index) => {
          const open = expanded.has(war.war_id);
          const detailId = `research-top-war-${war.war_id}`;
          return <Fragment key={war.war_id}>
            <tr><td>{index + 1}</td><th scope="row"><span>{war.winner.name} vs {war.loser.name}</span><small>Winner vs loser · War {war.war_id}</small></th>
              <td>{money(war.gross_value)}</td><td>{money(war.winner.gross_value)}</td><td>{money(war.loser.gross_value)}</td><td>{number(war.duration_hours)} hours</td>
              <td><button className="admin-button" type="button" aria-expanded={open} aria-controls={detailId} aria-label={`${open ? 'Hide' : 'Show'} stats for war ${war.war_id}`} onClick={() => setExpanded(previous => {
                const next = new Set(previous); if (next.has(war.war_id)) next.delete(war.war_id); else next.add(war.war_id); return next;
              })}>{open ? 'Hide stats' : 'Show stats'}</button></td>
            </tr>
            <tr hidden={!open} id={detailId}><td colSpan={7}>
              <div className="research-top-war-detail">
                <a href={`https://www.torn.com/war.php?step=rankreport&rankID=${war.war_id}`} target="_blank" rel="noopener noreferrer">View Torn report for war {war.war_id}</a>
                <table className="stock-status-table"><caption>Faction stats for war {war.war_id}</caption>
                  <thead><tr><th scope="col">Stat</th><th scope="col">Winner: {war.winner.name} [{war.winner.id}]</th><th scope="col">Loser: {war.loser.name} [{war.loser.id}]</th></tr></thead>
                  <tbody>{stats.map(stat => <tr key={stat.label}><th scope="row">{stat.label}</th><td>{stat.value(war.winner)}</td><td>{stat.value(war.loser)}</td></tr>)}</tbody>
                </table>
                <p><strong>Combined war score:</strong> {number(war.combined_score)} · <strong>Attack balance between the two factions:</strong> {war.attack_balance.toFixed(3)} {war.winner.attacks + war.loser.attacks ? '(0.5 means equal attacks)' : '(no reported attacks)'}</p>
                <p>Participation: share of listed members who attacked. Attack share from busiest 20%: share of member attacks made by the busiest 20% of listed members, rounded up.</p>
                {[war.winner, war.loser].map(f => f.warnings.length > 0 && <p key={f.id}><strong>{f.name} — data notes:</strong> {f.warnings.join(' ')} This war remains in the reward ranking. Combined-war graphs exclude this war; individual-faction graphs exclude this faction.</p>)}
              </div>
            </td></tr>
          </Fragment>;
        })}</tbody>
      </table></div>
    </>}
  </section>;
}
