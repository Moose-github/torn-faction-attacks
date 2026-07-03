import { describe, expect, it } from "vitest";
import { classifyArrestScoutTarget } from "./scoring";
import type { ArrestScoutSettings } from "./model";

const settings: ArrestScoutSettings = {
  lookback_seconds: 7 * 24 * 60 * 60,
  min_counterfeiting_delta: 500,
  required_forgeryskill: 100,
};

describe("classifyArrestScoutTarget", () => {
  it("ignores targets below 100 forgery skill", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 99, counterfeiting: 10_000, jailed: 5 },
      null,
      settings,
    );

    expect(result.classification).toBe("ignored");
    expect(result.score).toBe(0);
  });

  it("marks max-skill targets below the counterfeiting threshold inactive", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 100, counterfeiting: 10_400, jailed: 5 },
      { forgeryskill: 100, counterfeiting: 10_000, jailed: 5 },
      settings,
    );

    expect(result.classification).toBe("inactive");
    expect(result.counterfeiting_delta).toBe(400);
    expect(result.jailed_delta).toBe(0);
  });

  it("marks active max-skill targets without jailed delta as current targets", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 100, counterfeiting: 10_600, jailed: 5 },
      { forgeryskill: 100, counterfeiting: 10_000, jailed: 5 },
      settings,
    );

    expect(result.classification).toBe("current_target");
    expect(result.score).toBe(700);
  });

  it("marks active max-skill targets with jailed delta as future targets", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 100, counterfeiting: 10_600, jailed: 6 },
      { forgeryskill: 100, counterfeiting: 10_000, jailed: 5 },
      settings,
    );

    expect(result.classification).toBe("future_target");
    expect(result.score).toBe(600);
  });

  it("returns error for missing required stats", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 100, counterfeiting: null, jailed: 6 },
      { forgeryskill: 100, counterfeiting: 10_000, jailed: 5 },
      settings,
    );

    expect(result.classification).toBe("error");
    expect(result.notes).toEqual(["missing_counterfeiting"]);
  });

  it("returns error for negative deltas", () => {
    const result = classifyArrestScoutTarget(
      { forgeryskill: 100, counterfeiting: 9_000, jailed: 5 },
      { forgeryskill: 100, counterfeiting: 10_000, jailed: 5 },
      settings,
    );

    expect(result.classification).toBe("error");
    expect(result.notes).toEqual(["negative_delta"]);
  });
});
