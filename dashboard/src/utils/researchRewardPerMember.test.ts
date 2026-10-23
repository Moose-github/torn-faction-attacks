import { describe, expect, it } from 'vitest';
import type { ResearchFactorGraphs } from '../../../shared/rankedResearch';
import { rewardPerMemberGraph } from './researchRewardPerMember';

function fixture(): ResearchFactorGraphs {
  return { observations: 3, wars: 2, value_range: [0, 1200], factors: [
    { field: 'listed_members', label: 'Roster', unit: 'members', range: [10, 40], medians: [] },
    { field: 'score', label: 'Score', unit: 'score', range: [100, 300], medians: [] },
  ], points: [
    { war_id: 1, faction_id: 1, value: 1200, values: [40, 300] },
    { war_id: 1, faction_id: 2, value: 600, values: [10, 100] },
    { war_id: 2, faction_id: 3, value: 0, values: [20, 200] },
  ] };
}

describe('reward per listed member graph', () => {
  it('uses each observation’s own roster and score, including zero rewards, without changing saved data', () => {
    const source = fixture(), before = structuredClone(source);
    const graph = rewardPerMemberGraph(source)!;
    expect(graph.points.map(p => [p.war_id, p.faction_id, p.value, p.values[0]])).toEqual([[1, 1, 30, 300], [1, 2, 60, 100], [2, 3, 0, 200]]);
    expect(graph).toMatchObject({ observations: 3, wars: 2, value_range: [0, 60], factors: [{ range: [100, 300], medians: [] }] });
    expect(source).toEqual(before);
  });
  it('normalises a combined pot by the combined roster, not the winner roster or average faction ratio', () => {
    const source = fixture();
    source.points = [{ war_id: 1, faction_id: 1, value: 1800, values: [50, 400] }];
    expect(rewardPerMemberGraph(source)!.points[0]).toMatchObject({ value: 36, values: [400] });
  });
  it('limits counts and ranges to displayed sampled observations', () => {
    const source = fixture(); source.observations = 5000; source.wars = 2500; source.value_range = [0, 1000000];
    expect(rewardPerMemberGraph(source)).toMatchObject({ observations: 3, wars: 2, value_range: [0, 60] });
  });
  it('omits invalid denominators and scores without substituting zero', () => {
    const source = fixture();
    source.points.push(...[0, -1, NaN, Infinity].map((roster, i) => ({ war_id: i + 3, faction_id: 1, value: 100, values: [roster, 100] })));
    source.points.push({ war_id: 8, faction_id: 1, value: 100, values: [10, NaN] }, { war_id: 9, faction_id: 1, value: Infinity, values: [10, 200] });
    expect(rewardPerMemberGraph(source)!.points).toHaveLength(3);
  });
  it('handles missing factors and empty datasets', () => {
    const source = fixture(); source.points = [];
    expect(rewardPerMemberGraph(source)).toMatchObject({ observations: 0, wars: 0, points: [], value_range: [0, 0] });
    source.factors = source.factors.slice(0, 1);
    expect(rewardPerMemberGraph(source)).toBeNull();
    source.factors = [fixture().factors[1]];
    expect(rewardPerMemberGraph(source)).toBeNull();
  });
});
