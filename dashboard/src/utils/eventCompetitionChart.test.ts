import { describe, expect, it } from "vitest";
import { eventCompetitionChartData } from "./eventCompetitionChart";

describe("Halloween graph timeline", () => {
  it("combines hourly chains and less frequent treats while preserving unknown chain gaps", () => {
    expect(eventCompetitionChartData({
      history: [{ observed_at: 0, treats_gained: 0 }, { observed_at: 5400, treats_gained: 50 }],
      chain_history: [{ observed_at: 0, chain: 100 }, { observed_at: 3600, chain: null }, { observed_at: 7200, chain: 2 }],
    })).toEqual([
      { observed_at: 0, treats_gained: 0, chain: 100, chain_sampled_at: 0 },
      { observed_at: 3600, treats_gained: 0, chain: null, chain_sampled_at: 3600 },
      { observed_at: 5400, treats_gained: 50, chain: null, chain_sampled_at: 3600 },
      { observed_at: 7200, treats_gained: 50, chain: 2, chain_sampled_at: 7200 },
    ]);
  });

  it("does not invent treats before their first reading and retains zero chain counts", () => {
    const points = eventCompetitionChartData({ history: [{ observed_at: 500, treats_gained: 10 }],
      chain_history: [{ observed_at: 0, chain: 0 }] });
    expect(points[0]).toMatchObject({ treats_gained: null, chain: 0 });
    expect(points[1]).toMatchObject({ treats_gained: 10, chain: 0, chain_sampled_at: 0 });
  });

  it("supports older responses without chain history", () => {
    expect(eventCompetitionChartData({ history: [{ observed_at: 100, treats_gained: 10 }] }))
      .toEqual([{ observed_at: 100, treats_gained: 10, chain: null, chain_sampled_at: null }]);
  });
});
