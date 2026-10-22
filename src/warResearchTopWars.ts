import type { ResearchAnalysis, ResearchTopFaction, ResearchTopWars } from '../shared/rankedResearch';
import type { Env } from './types';

// Eligible stored reports have already passed validateResearchReport. Keep the
// derived member statistics in sync with research/extraction.py.
type SavedFaction = {
  id: number; name?: string; rank: { before: string }; attacks: number; score: number;
  rewards: { items: { name: string; quantity: number }[] };
  members: { attacks: number; score: number }[];
};
type SavedReport = { id: number; start: number; end: number; winner: number; factions: SavedFaction[] };

function factionStats(f: SavedFaction, prices: ResearchAnalysis['prices']): ResearchTopFaction {
  const hits = f.members.map(m => m.attacks).sort((a, b) => b - a);
  const memberAttacks = hits.reduce((sum, value) => sum + value, 0);
  const memberScore = f.members.reduce((sum, m) => sum + m.score, 0);
  const warnings: string[] = [];
  if (memberAttacks !== f.attacks) warnings.push('Member attack sum differs from faction attack total.');
  if (Math.abs(memberScore - f.score) > Math.max(2, f.members.length * 0.02)) warnings.push('Member score sum differs from faction score total.');
  return {
    id: f.id, name: String(f.name ?? f.id), rank_before: f.rank.before,
    gross_value: f.rewards.items.reduce((sum, item) => sum + (item.quantity ? item.quantity * prices[item.name]! : 0), 0),
    attacks: f.attacks, score: f.score, listed_members: f.members.length,
    participation_rate: hits.filter(h => h > 0).length / hits.length,
    top20_attack_share: memberAttacks ? hits.slice(0, Math.max(1, Math.ceil(hits.length * 0.2))).reduce((sum, h) => sum + h, 0) / memberAttacks : 0,
    warnings,
  };
}

export async function getResearchTopWars(env: Env, runId: string, saved: Pick<ResearchAnalysis, 'prices' | 'range'>): Promise<ResearchTopWars> {
  // Rank every eligible saved report in SQL, not the sampled graph points.
  // Only the five winning reports cross the DB boundary. A missing price on
  // either side excludes the entire pot; empty rewards and zero prices are valid.
  const rows = await env.DB.prepare(`WITH prices AS (SELECT key AS name, value AS price FROM json_each(?)),
    valued AS (
      SELECT p.war_id,
        COALESCE(SUM(json_extract(item.value, '$.quantity') * prices.price), 0) AS gross_value
      FROM ranked_research_run_wars w JOIN ranked_research_reports p USING (war_id)
      JOIN json_each(p.report_json, '$.rankedwarreport.factions') f
      LEFT JOIN json_each(f.value, '$.rewards.items') item ON 1 = 1
      LEFT JOIN prices ON prices.name = json_extract(item.value, '$.name')
      WHERE w.run_id = ? AND p.classification = 'eligible' AND p.report_json IS NOT NULL
        AND p.start BETWEEN ? AND ?
      GROUP BY p.war_id
      HAVING SUM(CASE WHEN json_extract(item.value, '$.quantity') > 0 AND prices.price IS NULL THEN 1 ELSE 0 END) = 0
    ), top_wars AS (
      SELECT war_id, gross_value, COUNT(*) OVER () AS valued_wars FROM valued
      ORDER BY gross_value DESC, war_id ASC LIMIT 5
    )
    SELECT t.*, p.report_json FROM top_wars t JOIN ranked_research_reports p USING (war_id)
    ORDER BY t.gross_value DESC, t.war_id ASC`)
    .bind(JSON.stringify(saved.prices), runId, Date.parse(saved.range.start + 'T00:00:00Z') / 1000,
      Date.parse(saved.range.end + 'T00:00:00Z') / 1000 + 86399)
    .all<{ war_id: number; gross_value: number; valued_wars: number; report_json: string }>();
  return { valued_wars: rows.results[0]?.valued_wars ?? 0, wars: rows.results.map(row => {
    const r = (JSON.parse(row.report_json) as { rankedwarreport: SavedReport }).rankedwarreport;
    const winner = factionStats(r.factions.find(f => f.id === r.winner)!, saved.prices);
    const loser = factionStats(r.factions.find(f => f.id !== r.winner)!, saved.prices);
    const attacks = winner.attacks + loser.attacks;
    return { war_id: row.war_id, gross_value: row.gross_value, duration_hours: (r.end - r.start) / 3600,
      combined_score: winner.score + loser.score, attack_balance: attacks ? Math.min(winner.attacks, loser.attacks) / attacks : 0,
      winner, loser };
  }) };
}
