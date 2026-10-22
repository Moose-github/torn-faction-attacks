import type { ResearchAnalysis, ResearchGraphs, ResearchFactorGraphs, WarResearchResultsResponse } from '../shared/rankedResearch';
import type { Env } from './types';
import { json } from './utils';
import { getResearchTopWars } from './warResearchTopWars';

function factorGraphs(graphs?: ResearchGraphs): ResearchFactorGraphs | undefined {
  if (!graphs) return undefined;
  const { observations, wars, value_range, factors, points } = graphs;
  return { observations, wars, value_range, factors, points };
}

export async function getWarResearchResults(env: Env): Promise<Response> {
  const row = await env.DB.prepare(`SELECT r.id AS run_id, r.name, a.result_json FROM ranked_research_analyses a
    JOIN ranked_research_runs r ON r.id = a.run_id
    WHERE r.status = 'frozen' AND a.snapshot_token = r.snapshot_token
    ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`).first<{ run_id: string; name: string; result_json: string }>();
  if (!row) return json({ ok: true, result: null } satisfies WarResearchResultsResponse);
  const saved = JSON.parse(row.result_json) as ResearchAnalysis;
  const topWars = await getResearchTopWars(env, row.run_id, saved);
  // Member display exposes summary stats only, never collector state or raw reports.
  return json({ ok: true, result: {
    name: row.name, generated_at: saved.generated_at, range: saved.range, prices: saved.prices,
    coverage: saved.coverage, combined: factorGraphs(saved.whole_war?.graphs), faction: factorGraphs(saved.graphs),
    top_wars: topWars,
  } } satisfies WarResearchResultsResponse);
}
