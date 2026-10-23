import type { ResearchFactorGraphs } from '../../../shared/rankedResearch';

// Divide each observation's reward by its own roster, never aggregate medians.
// Whole-war graph observations already contain both factions' combined roster.
export function rewardPerMemberGraph(source: ResearchFactorGraphs): ResearchFactorGraphs | null {
  const scoreIndex = source.factors.findIndex(f => f.field === 'score');
  const rosterIndex = source.factors.findIndex(f => f.field === 'listed_members');
  if (scoreIndex < 0 || rosterIndex < 0) return null;
  const points = source.points.flatMap(p => {
    const score = p.values[scoreIndex], roster = p.values[rosterIndex];
    if (!Number.isFinite(score) || score < 0 || !Number.isFinite(roster) || roster <= 0
      || !Number.isFinite(p.value) || p.value < 0) return [];
    const value = p.value / roster;
    if (!Number.isFinite(value)) return [];
    return [{ war_id: p.war_id, faction_id: p.faction_id, value, values: [score] }];
  });
  const scores = points.map(p => p.values[0]), rewards = points.map(p => p.value);
  return {
    observations: points.length, wars: new Set(points.map(p => p.war_id)).size,
    value_range: rewards.length ? [Math.min(...rewards), Math.max(...rewards)] : [0, 0],
    factors: [{ field: 'score', label: 'War score', unit: 'score',
      range: scores.length ? [Math.min(...scores), Math.max(...scores)] : [0, 0], medians: [] }],
    points,
  };
}
