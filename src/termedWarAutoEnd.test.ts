import { describe, expect, it } from "vitest";
import {
  attackFallsWithinLiveWarWindow,
  buildTermedWarAutoEndDiscordMessage,
  findTermedWarLimitCrossingAttack,
  findTermedWarLimitCrossingAttackTime,
  type TermedWarCrossingAttackRow,
  type WarWindowForAttackAssignment,
} from "./ingestion";

describe("termed war auto-end cutoff", () => {
  it("uses the ended timestamp from the first raw respect crossing hit", () => {
    const rows = [
      crossingRow({ id: 1, started: 100, ended: 130, respect_gain: 45 }),
      crossingRow({ id: 2, started: 140, ended: 170, respect_gain: 55 }),
      crossingRow({ id: 3, started: 180, ended: 210, respect_gain: 20 }),
    ];

    expect(findTermedWarLimitCrossingAttackTime(rows, 100)).toBe(170);
    expect(findTermedWarLimitCrossingAttack(rows, 100)?.id).toBe(2);
  });

  it("falls back to started when the crossing hit has no ended timestamp", () => {
    const rows = [
      crossingRow({ id: 1, started: 100, ended: 130, respect_gain: 60 }),
      crossingRow({ id: 2, started: 160, ended: null, respect_gain: 40 }),
    ];

    expect(findTermedWarLimitCrossingAttackTime(rows, 100)).toBe(160);
  });

  it("returns null when stored hits do not reach the faction respect limit", () => {
    const rows = [
      crossingRow({ id: 1, started: 100, ended: 130, respect_gain: 25 }),
      crossingRow({ id: 2, started: 160, ended: 190, respect_gain: 25 }),
    ];

    expect(findTermedWarLimitCrossingAttackTime(rows, 100)).toBeNull();
  });

  it("does not assign attacks that finish after the practical cutoff", () => {
    const war = assignmentWindow({ practical_finish_time: 200 });

    expect(attackFallsWithinLiveWarWindow({ started: 190, ended: 201 }, war)).toBe(false);
    expect(attackFallsWithinLiveWarWindow({ started: 190, ended: 200 }, war)).toBe(true);
  });

  it("applies official end cutoff to attack finish time", () => {
    const war = assignmentWindow({ official_end_time: 300 });

    expect(attackFallsWithinLiveWarWindow({ started: 290, ended: 301 }, war)).toBe(false);
    expect(attackFallsWithinLiveWarWindow({ started: 290, ended: null }, war)).toBe(true);
  });

  it("formats the Discord auto-end message with score, last attack, and finish time", () => {
    expect(buildTermedWarAutoEndDiscordMessage({
      currentScore: 1234,
      targetScore: 1000,
      finishAt: Date.UTC(2026, 4, 23, 14, 5, 6) / 1000,
      crossingAttack: {
        attacker_name: "Attacker One",
        defender_name: "Defender Two",
      },
    })).toBe([
      "Score limit reached: 1,234/1,000",
      "Last attack: Attacker One v Defender Two",
      "Finish time: 23rd May 2026 14:05:06 UTC",
    ].join("\n"));
  });
});

function crossingRow(overrides: Partial<TermedWarCrossingAttackRow>): TermedWarCrossingAttackRow {
  return {
    id: 1,
    started: 100,
    ended: 120,
    respect_gain: 0,
    ...overrides,
  };
}

function assignmentWindow(
  overrides: Partial<WarWindowForAttackAssignment>,
): WarWindowForAttackAssignment {
  return {
    practical_start_time: 100,
    practical_finish_time: null,
    official_end_time: null,
    ...overrides,
  };
}
