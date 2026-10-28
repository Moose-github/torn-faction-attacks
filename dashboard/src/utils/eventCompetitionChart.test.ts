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
    expect(points.map(p => [p.observed_at, p.treats_point])).toEqual([
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
    expect(points.map(p => p.treats_point)).toEqual([0, 50, 70]);
  });

  it("fits the collection totals equally, without weighting partial member updates", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [
      reading(0, 0), reading(6, 2), reading(6.5, 5), reading(7, 10), reading(14, 30),
    ], chain_history: [{ observed_at: START + 3.5 * HOUR, chain: 100 }] }, START);
    // Least squares for (0,0), (7,10), (14,30): intercept -5/3, slope 15/7.
    expect(points[0].treats_trend).toBeCloseTo(-5 / 3);
    expect(points[1].treats_trend).toBeCloseTo(35 / 6);
    expect(points[points.length - 1].treats_trend).toBeCloseTo(85 / 3);
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
      .toEqual([{ observed_at: START, treats_point: 10, treats_trend: null, treats_gained: 10, treats_sampled_at: START, chain: null, chain_sampled_at: null }]);
    expect(eventCompetitionChartData({ refresh_hours: 6, history: [] }, START)).toEqual([]);
  });

  it("preserves a flat zero trend and gaps between collection windows", () => {
    const points = eventCompetitionChartData({ refresh_hours: 6, history: [reading(0, 0), reading(18, 0)] }, START);
    expect(points).toHaveLength(2);
    expect(points.map(p => p.treats_trend)).toEqual([0, 0]);
  });
});
