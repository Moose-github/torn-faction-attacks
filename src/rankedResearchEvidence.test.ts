import { describe, expect, it } from 'vitest';
import { validateResearchEvidence } from './rankedResearchEvidence';

const graph = () => ({ observations: 1, wars: 1, value_range: [0, 0],
  factors: [{ field: 'attacks', label: 'Attacks', unit: 'attacks', range: [10, 10], medians: [{ x: 10, y: 0, n: 1 }] }],
  points: [{ war_id: 1, faction_id: 2, value: 0, values: [10] }],
  distributions: [{ label: 'P1 / P2', n: 1, wars: 1, five_number: [0, 0, 0, 0, 0] }],
});
function validate(value: Record<string, unknown>) {
  validateResearchEvidence(value, (ok, message) => { if (!ok) throw new Error(message); });
}

describe('research graph uploads', () => {
  it('accepts legacy results and graphs without coverage, including zero rewards', () => {
    expect(() => validate({})).not.toThrow();
    expect(() => validate({ model_observations: 1, graphs: graph(), whole_war: { model_observations: 1, graphs: graph() } })).not.toThrow();
  });
  it('rejects mismatched samples and malformed points for either reward view', () => {
    for (const graphs of [
      { ...graph(), observations: 2 }, { ...graph(), points: [] },
      { ...graph(), points: [{ ...graph().points[0], values: [] }] },
      { ...graph(), points: [{ ...graph().points[0], values: [11] }] },
      { ...graph(), points: [{ ...graph().points[0], value: NaN }] },
      { ...graph(), points: Array(1001).fill(graph().points[0]) },
    ]) {
      expect(() => validate({ model_observations: 1, graphs })).toThrow();
      expect(() => validate({ whole_war: { model_observations: 1, graphs } })).toThrow();
    }
  });
  it('rejects inconsistent medians and distribution quartiles', () => {
    for (const graphs of [
      { ...graph(), factors: [{ ...graph().factors[0], medians: [] }] },
      { ...graph(), factors: [graph().factors[0], graph().factors[0]] },
      { ...graph(), distributions: [] },
      { ...graph(), distributions: [{ ...graph().distributions[0], five_number: [0, 2, 1, 3, 4] }] },
      { ...graph(), distributions: [{ ...graph().distributions[0], five_number: [-1, 0, 0, 0, 0] }] },
    ]) expect(() => validate({ model_observations: 1, graphs })).toThrow();
  });
});
