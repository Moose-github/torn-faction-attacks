import { describe, expect, it } from "vitest";
import { withHistory } from "./useWarRoomData";

describe("War Room live/history ownership", () => {
  it("keeps fresh live values when an older history request finishes later", () => {
    const live = { latest: { created_at: 200, score: 12 }, settings: { threshold: 4 }, history: [] as number[] };
    const history = { latest: { created_at: 100, score: 3 }, settings: { threshold: 2 }, history: [1, 2, 3] };
    expect(withHistory(live, history)).toEqual({ ...live, history: history.history });
    expect(live.history).toEqual([]);
  });

  it("retains history across thin updates and uses the full response before live data arrives", () => {
    const full = { latest: 10, history: [1, 2] };
    expect(withHistory(null, full)).toEqual(full);
    expect(withHistory({ latest: 20, history: [] }, full)).toEqual({ latest: 20, history: [1, 2] });
    expect(withHistory(null, null)).toBeNull();
  });
});
