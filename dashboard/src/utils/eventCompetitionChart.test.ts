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

  it("fits the collection totals equally, without weighting partial member updates", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6, 2), reading(6.5, 5), reading(7, 10), reading(14, 30),
    ], chain_history: [{ observed_at: START + 3.5 * HOUR, chain: 100 }] }, START);
    // Quadratic for (0,0), (7,10), (14,30): y = 5(t/7)² + 5(t/7).
    expect(points[0].treats_trend).toBeCloseTo(0);
    expect(points.find(p => p.observed_at === START + 3.5 * HOUR)?.treats_trend).toBeCloseTo(3.75);
    expect(points[points.length - 1].treats_trend).toBeCloseTo(30);
    expect(points.filter(p => p.treats_point !== null)).toHaveLength(3);
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
    expect(points[0]).toMatchObject({ treats_point: null, treats_trend: null, treats_gained: null, treats_sampled_at: null, chain: 0 });
    expect(points[1]).toMatchObject({ treats_point: 0, treats_gained: 0, chain: 0, chain_sampled_at: START });
    expect(points[2]).toMatchObject({ treats_point: null, treats_gained: 0, chain: null, chain_sampled_at: START + HOUR });
    expect(points[3]).toMatchObject({ treats_point: 50, chain: null });
    expect(points[4]).toMatchObject({ treats_point: null, treats_trend: null, treats_gained: 50, treats_sampled_at: START + 6.1 * HOUR, chain: 2 });
  });

  it("does not invent a trend for a single reading or empty history", () => {
    expect(eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 10)] }, START))
      .toEqual([{ observed_at: START, treats_point: 10, treats_trend: null, treats_gained: 10, treats_sampled_at: START, chain: null, chain_sampled_at: null, successful_attacks: null, attacks_sampled_at: null }]);
    expect(eventCompetitionChartData({ refresh_hours: 6, history: [] }, START)).toEqual([]);
  });

  it("preserves a flat zero trend and gaps between collection windows", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 0), reading(18, 0)] }, START);
    expect(points).toHaveLength(2);
    expect(points.map(p => p.treats_trend)).toEqual([0, 0]);
  });

  it("starts successful attacks at their first sample, preserves zero and carries hourly totals across curve points", () => {
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
    expect(points.find(p => p.observed_at === START + 4.5 * HOUR)).toMatchObject({ successful_attacks: 20, attacks_sampled_at: START + 4 * HOUR });
    expect(points.filter(p => p.attacks_sampled_at === p.observed_at)).toHaveLength(2);
  });

  it("uses least squares across noisy readings instead of passing through every dot", () => {
    // Residuals [-1, 3, -3, 1] are orthogonal to 1, x and x², so the fit
    // recovers y = 10 + x² exactly for x = hours / 6.
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 9), reading(6, 14), reading(12, 11), reading(18, 20),
    ] }, START);
    for (const point of points) {
      const x = (point.observed_at - START) / (6 * HOUR);
      expect(point.treats_trend).toBeCloseTo(10 + x * x, 6);
    }
    expect(points[0].treats_trend).not.toBe(points[0].treats_point);
  });

  it("renders a curve without chain history and does not create extra measured dots", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6, 100), reading(12, 400),
    ] }, START);
    expect(points.length).toBeGreaterThan(100);
    const estimated = points.find(p => p.observed_at === START + 3 * HOUR);
    expect(estimated?.treats_trend).toBeCloseTo(25);
    expect(estimated).toMatchObject({
      treats_point: null, treats_gained: 0, treats_sampled_at: START,
      chain: null, chain_sampled_at: null,
    });
    expect(points.filter(p => p.treats_point !== null)).toHaveLength(3);
  });

  it("keeps chain gaps and the curve's time bounds when adding estimated points", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(1, 0), reading(7, 100), reading(13, 400),
    ], chain_history: [
      { observed_at: START, chain: 10 },
      { observed_at: START + 5 * HOUR, chain: null },
      { observed_at: START + 10 * HOUR, chain: 20 },
      { observed_at: START + 14 * HOUR, chain: 30 },
    ] }, START);
    expect(points[0].treats_trend).toBeNull();
    expect(points[points.length - 1].treats_trend).toBeNull();
    expect(points.filter(p => p.observed_at >= START + 5 * HOUR && p.observed_at < START + 10 * HOUR)
      .every(p => p.chain === null)).toBe(true);
  });

  it("falls back to a straight fit for two readings and stays finite for closely spaced points", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 0), reading(6, 60)],
      chain_history: [{ observed_at: START + 3 * HOUR, chain: 10 }] }, START);
    expect(points[1].treats_trend).toBeCloseTo(30);
    const close = eventCompetitionChartData({ refresh_hours: 6, history: [
      { observed_at: START + 21600 - 0.001, treats_gained: 0 },
      { observed_at: START + 21600, treats_gained: 0 },
      reading(100000, 100),
    ] }, START);
    expect(close.every(p => Number.isFinite(p.treats_trend))).toBe(true);
  });
});
