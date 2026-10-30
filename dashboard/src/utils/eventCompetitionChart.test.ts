import { describe, expect, it } from "vitest";
import { eventCompetitionChartData } from "./eventCompetitionChart";

const START = 1793404800;
const HOUR = 3600;
const reading = (hours: number, treats_gained: number) => ({ observed_at: START + hours * HOUR, treats_gained });

describe("Halloween graph timeline", () => {
  it("keeps only the highest total per collection and the latest timestamp on ties", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(6.1, 80), reading(0, 0), reading(6, 20), reading(6.05, 80),
      reading(6.2, 70), reading(12.1, 150), reading(12, 120),
    ] }, START);
    expect(points.filter(p => p.treats_point !== null).map(p => [p.observed_at, p.treats_point])).toEqual([
      [START, 0], [START + 6.1 * HOUR, 80], [START + 12.1 * HOUR, 150],
    ]);
  });

  it("anchors windows to event start and respects the configured collection interval", () => {
    const points = eventCompetitionChartData({ refresh_hours: 12, history: [
      reading(0, 0), reading(11.9, 50), reading(12, 80), reading(12.1, 100),
    ] }, START);
    expect(points.map(p => p.treats_point)).toEqual([50, 100]);
  });

  it("keeps a final collection separate even when it precedes the next regular collection", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6.1, 50), reading(8.01, 60), reading(8.1, 70),
    ] }, START, START + 8 * HOUR);
    expect(points.filter(p => p.treats_point !== null).map(p => p.treats_point)).toEqual([0, 50, 70]);
  });

  it("plots one total per collection without plotting partial member updates", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6, 2), reading(6.5, 5), reading(7, 10), reading(14, 30),
    ], chain_history: [{ observed_at: START + 3.5 * HOUR, chain: 100 }] }, START);
    expect(points.filter(p => p.treats_point !== null).map(p => p.treats_point)).toEqual([0, 10, 30]);
    expect(points.find(p => p.observed_at === START + 3.5 * HOUR)).toMatchObject({ treats_point: null, treats_gained: 0, chain: 100 });
  });

  it("merges chain samples without duplicating treats dots, inventing readings or filling chain gaps", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6,
      history: [reading(0.1, 0), reading(6.1, 50)],
      chain_history: [
        { observed_at: START, chain: 0 },
        { observed_at: START + HOUR, chain: null },
        { observed_at: START + 7 * HOUR, chain: 2 },
      ],
    }, START);
    expect(points[0]).toMatchObject({ treats_point: null, treats_gained: null, treats_sampled_at: null, chain: 0 });
    expect(points[1]).toMatchObject({ treats_point: 0, treats_gained: 0, chain: 0, chain_sampled_at: START });
    expect(points[2]).toMatchObject({ treats_point: null, treats_gained: 0, chain: null, chain_sampled_at: START + HOUR });
    expect(points[3]).toMatchObject({ treats_point: 50, chain: null });
    expect(points[4]).toMatchObject({ treats_point: null, treats_gained: 50, treats_sampled_at: START + 6.1 * HOUR, chain: 2 });
  });

  it("plots a single reading and nothing for an empty history", () => {
    expect(eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 10)] }, START))
      .toEqual([{ observed_at: START, treats_point: 10, treats_gained: 10, treats_sampled_at: START, chain: null, chain_sampled_at: null, successful_attacks: null, attacks_sampled_at: null }]);
    expect(eventCompetitionChartData({ refresh_hours: 6, history: [] }, START)).toEqual([]);
  });

  it("preserves zero totals and gaps between collection windows without estimating", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 0), reading(18, 0)] }, START);
    expect(points.map(p => [p.observed_at, p.treats_point])).toEqual([[START, 0], [START + 18 * HOUR, 0]]);
  });

  it("starts successful attacks at their first sample, preserves zero and carries hourly totals across other samples", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6,
      history: [reading(0, 0), reading(6, 100), reading(12, 400)],
      successful_attack_history: [
        { observed_at: START + 3 * HOUR, successful_attacks: 0 },
        { observed_at: START + 4 * HOUR, successful_attacks: 20 },
      ],
      chain_history: [{ observed_at: START + 4 * HOUR, chain: 1 }],
    }, START);
    expect(points.filter(p => p.observed_at < START + 3 * HOUR)
      .every(p => p.successful_attacks === null && p.attacks_sampled_at === null)).toBe(true);
    expect(points.find(p => p.observed_at === START + 3 * HOUR)).toMatchObject({ successful_attacks: 0, attacks_sampled_at: START + 3 * HOUR });
    expect(points.find(p => p.observed_at === START + 4 * HOUR)).toMatchObject({ successful_attacks: 20, chain: 1 });
    expect(points.find(p => p.observed_at === START + 6 * HOUR)).toMatchObject({ successful_attacks: 20, attacks_sampled_at: START + 4 * HOUR });
    expect(points.filter(p => p.attacks_sampled_at === p.observed_at)).toHaveLength(2);
  });

  it("adds no estimated points between readings when chain history is missing", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6, 100), reading(12, 400),
    ] }, START);
    expect(points.map(p => [p.observed_at, p.treats_point])).toEqual([
      [START, 0], [START + 6 * HOUR, 100], [START + 12 * HOUR, 400],
    ]);
  });

  it("keeps chain gaps alongside treat readings", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(1, 0), reading(7, 100), reading(13, 400),
    ], chain_history: [
      { observed_at: START, chain: 10 },
      { observed_at: START + 5 * HOUR, chain: null },
      { observed_at: START + 10 * HOUR, chain: 20 },
      { observed_at: START + 14 * HOUR, chain: 30 },
    ] }, START);
    expect(points.filter(p => p.treats_point !== null).map(p => p.treats_point)).toEqual([0, 100, 400]);
    expect(points.filter(p => p.observed_at >= START + 5 * HOUR && p.observed_at < START + 10 * HOUR)
      .every(p => p.chain === null)).toBe(true);
  });
});
