import { describe, expect, it } from "vitest";
import {
  CHAIN_WATCH_TIMEOUT_SECONDS,
  chainHitAt,
  chainWatchAlertEligible,
  chainWatchDroppedMessage,
  chainWatchNormalMessage,
  chainWatchWarningMessage,
  isQualifyingChainAttack,
  parseTornChainResponse,
  selectNextChainWatchAlarm,
  type ChainWatchAttackRow,
} from "./chainWatch";
import { HOME_FACTION_ID } from "./constants";

describe("chain watch stored attacks", () => {
  it("accepts successful outgoing home attacks against any non-home target", () => {
    expect(isQualifyingChainAttack(attackRow({
      attacker_faction_id: HOME_FACTION_ID,
      defender_faction_id: 123,
      result: "Hospitalized",
    }))).toBe(true);
  });

  it("does not require the matched war faction", () => {
    expect(isQualifyingChainAttack(attackRow({
      attacker_faction_id: HOME_FACTION_ID,
      defender_faction_id: 999999,
      result: "Mugged",
    }))).toBe(true);
  });

  it("ignores unsuccessful or friendly attacks", () => {
    expect(isQualifyingChainAttack(attackRow({ result: "Lost" }))).toBe(false);
    expect(isQualifyingChainAttack(attackRow({ defender_faction_id: HOME_FACTION_ID }))).toBe(false);
  });

  it("uses ended before started for the reset time", () => {
    expect(chainHitAt(attackRow({ started: 100, ended: 130 }))).toBe(130);
    expect(chainHitAt(attackRow({ started: 100, ended: null }))).toBe(100);
  });

  it("uses a five minute timeout from the reset time", () => {
    const resetAt = chainHitAt(attackRow({ started: 100, ended: 130 }));
    expect((resetAt ?? 0) + CHAIN_WATCH_TIMEOUT_SECONDS).toBe(430);
  });
});

describe("chain watch alarm selection", () => {
  it("does not schedule alerts for chains at or below 100", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 100,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: null,
      warning30SentAt: null,
      dropSentAt: null,
      now: 1000,
    })).toBeNull();
  });

  it("schedules the 60 second warning four minutes after the reset", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 101,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: null,
      warning30SentAt: null,
      dropSentAt: null,
      now: 1000,
    })).toEqual({ stage: "warning_60", alarmAt: 1240 });
  });

  it("schedules the 30 second warning after the 60 second warning is sent", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 101,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: 1240,
      warning30SentAt: null,
      dropSentAt: null,
      now: 1240,
    })).toEqual({ stage: "warning_30", alarmAt: 1270 });
  });

  it("schedules the drop check after both warnings are sent", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 101,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: 1240,
      warning30SentAt: 1270,
      dropSentAt: null,
      now: 1270,
    })).toEqual({ stage: "drop", alarmAt: 1300 });
  });

  it("schedules an immediate drop check when the timeout has passed after a warning", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 101,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: 1240,
      warning30SentAt: null,
      dropSentAt: null,
      now: 1305,
    })).toEqual({ stage: "drop", alarmAt: 1305 });
  });

  it("does not schedule after the drop alert has been sent", () => {
    expect(selectNextChainWatchAlarm({
      currentChain: 101,
      resetAt: 1000,
      timeoutAt: 1300,
      warning60SentAt: 1240,
      warning30SentAt: 1270,
      dropSentAt: 1300,
      now: 1301,
    })).toBeNull();
  });
});

describe("chain watch live confirmation", () => {
  it("parses Torn timeout as seconds remaining", () => {
    expect(parseTornChainResponse({ chain: { current: 150, timeout: 45 } }, 1000)).toEqual({
      current: 150,
      timeoutAt: 1045,
      active: true,
    });
  });

  it("parses Torn timeout as an epoch timestamp", () => {
    expect(parseTornChainResponse({ chain: { current: 150, timeout: 1_800_000_000 } }, 1000)).toEqual({
      current: 150,
      timeoutAt: 1_800_000_000,
      active: true,
    });
  });

  it("treats zero current chain as inactive", () => {
    expect(parseTornChainResponse({ chain: { current: 0, timeout: 0 } }, 1000)).toEqual({
      current: 0,
      timeoutAt: null,
      active: false,
    });
  });
});

describe("chain watch alert eligibility", () => {
  it("requires chain to be strictly above 100", () => {
    expect(chainWatchAlertEligible(100)).toBe(false);
    expect(chainWatchAlertEligible(101)).toBe(true);
  });
});

describe("chain watch Discord messages", () => {
  it("formats the initial normal chain message", () => {
    expect(chainWatchNormalMessage({
      currentChain: 125,
      timeoutAt: 1_800_000_000,
    })).toBe([
      "Chain Watch: chain 125 is active.",
      "Timeout: <t:1800000000:R>",
    ].join("\n"));
  });

  it("labels the 30 second warning as critical", () => {
    expect(chainWatchWarningMessage({
      stage: "warning_30",
      currentChain: 125,
      timeoutAt: 1_800_000_000,
      lastHit: attackRow({ attacker_name: "Alice", defender_name: "Bob" }),
    })).toContain("Chain Watch CRITICAL: chain 125 30 seconds remaining");
  });

  it("formats dropped messages with the dropped-at timestamp", () => {
    expect(chainWatchDroppedMessage({
      currentChain: 125,
      timeoutAt: 1_800_000_000,
      lastHit: attackRow({ attacker_name: "Alice", defender_name: "Bob" }),
    })).toContain("Chain Watch: chain 125 dropped at 15 Jan 2027, 08:00:00.");
  });
});

function attackRow(overrides: Partial<ChainWatchAttackRow>): ChainWatchAttackRow {
  return {
    id: 1,
    started: 100,
    ended: 120,
    attacker_faction_id: HOME_FACTION_ID,
    defender_faction_id: 123,
    attacker_name: "Attacker",
    defender_name: "Defender",
    result: "Hospitalized",
    chain: 101,
    ...overrides,
  };
}
