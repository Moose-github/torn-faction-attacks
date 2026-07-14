import { describe, expect, it } from "vitest";
import {
  evaluateRetaliationAvailability,
  getRetaliationBoardRefreshPlan,
  getRetaliationCheck,
  renderRetaliationBoardPayload,
  resolveRetaliationOpportunity,
  type RetaliationAttackRow,
  type PendingRetaliationClaim,
} from "./retaliations";
import type { Env } from "./types";

describe("retaliation availability", () => {
  it("is available when an enemy attack has not been claimed", () => {
    const availability = evaluateRetaliationAvailability(attackRow({
      id: 1,
      attacker_id: 200,
      defender_id: 101,
      result: "Hospitalized",
      attack_at: 1000,
    }), null, 1100);

    expect(availability.available).toBe(true);
    expect(availability.reason).toBe("available");
    expect(availability.expires_at).toBe(1300);
  });

  it("is unavailable when a later outgoing retaliation hospitalization claimed it", () => {
    const availability = evaluateRetaliationAvailability(
      attackRow({
        id: 1,
        attacker_id: 200,
        defender_id: 101,
        result: "Mugged",
        attack_at: 1000,
      }),
      attackRow({
        id: 2,
        attacker_id: 101,
        defender_id: 200,
        result: "Hospitalized",
        m_retaliation: 2,
        attack_at: 1040,
      }),
      1100,
    );

    expect(availability.available).toBe(false);
    expect(availability.reason).toBe("claimed");
    expect(availability.claimed_by_attack?.id).toBe(2);
  });

  it("becomes available again when the latest enemy attack is newer than the claim", () => {
    const availability = evaluateRetaliationAvailability(attackRow({
      id: 3,
      attacker_id: 200,
      defender_id: 102,
      result: "Attacked",
      attack_at: 1120,
    }), null, 1130);

    expect(availability.available).toBe(true);
    expect(availability.enemy_attack?.id).toBe(3);
  });

  it("returns no opportunity when no unexpired enemy attack was found", () => {
    const availability = evaluateRetaliationAvailability(null, null);

    expect(availability.available).toBe(false);
    expect(availability.reason).toBe("none");
    expect(availability.expires_at).toBeNull();
  });

  it("expires opportunities after the five-minute window", () => {
    const availability = evaluateRetaliationAvailability(attackRow({
      id: 4,
      attacker_id: 200,
      defender_id: 101,
      result: "Hospitalized",
      attack_at: 1000,
    }), null, 1300);

    expect(availability.available).toBe(false);
    expect(availability.reason).toBe("none");
    expect(availability.status).toBe("expired");
    expect(availability.enemy_attack?.id).toBe(4);
    expect(availability.expires_at).toBe(1300);
  });

  it("marks an unexpired pending claim as claimed pending", () => {
    const availability = resolveRetaliationOpportunity(
      attackRow({
        id: 5,
        attacker_id: 200,
        defender_id: 101,
        result: "Hospitalized",
        attack_at: 1000,
      }),
      null,
      pendingClaim({
        opening_attack_id: 5,
        target_id: 200,
        claimant_torn_user_id: 101,
        expires_at: 1129,
      }),
      1100,
    );

    expect(availability.available).toBe(false);
    expect(availability.status).toBe("claimed_pending");
    expect(availability.pending_claim?.claimant_torn_user_id).toBe(101);
  });

  it("ignores an expired pending claim while the retaliation window remains open", () => {
    const availability = resolveRetaliationOpportunity(
      attackRow({
        id: 6,
        attacker_id: 200,
        defender_id: 101,
        result: "Hospitalized",
        attack_at: 1000,
      }),
      null,
      pendingClaim({
        opening_attack_id: 6,
        target_id: 200,
        claimant_torn_user_id: 101,
        expires_at: 1099,
      }),
      1100,
    );

    expect(availability.available).toBe(true);
    expect(availability.status).toBe("available");
    expect(availability.pending_claim).toBeNull();
  });

  it("prioritizes confirmed Torn claims over pending claims", () => {
    const availability = resolveRetaliationOpportunity(
      attackRow({
        id: 7,
        attacker_id: 200,
        defender_id: 101,
        result: "Hospitalized",
        attack_at: 1000,
      }),
      attackRow({
        id: 8,
        attacker_id: 101,
        defender_id: 200,
        result: "Hospitalized",
        m_retaliation: 2,
        attack_at: 1020,
      }),
      pendingClaim({
        opening_attack_id: 7,
        target_id: 200,
        claimant_torn_user_id: 102,
        expires_at: 1129,
      }),
      1100,
    );

    expect(availability.status).toBe("claimed_confirmed");
    expect(availability.pending_claim).toBeNull();
    expect(availability.claimed_by_attack?.id).toBe(8);
  });

  it("rejects invalid target IDs before touching storage", async () => {
    const response = await getRetaliationCheck(
      new URL("https://worker.test/api/retaliations/check?target_id=nope"),
      {} as Env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INVALID_TARGET_ID",
    });
  });

  it("renders the Discord board as compact retal embeds", () => {
    const available = resolveRetaliationOpportunity(
      attackRow({
        id: 5001,
        code: "attack-log-1",
        attacker_id: 2054500,
        attacker_name: "nex",
        attacker_faction_id: 1234,
        attacker_faction_name: "Vulpes Vulpes",
        defender_id: 123,
        defender_name: "Whiskas",
        result: "Hospitalized",
        respect_gain: 2.86,
        attack_at: 1000,
      }),
      null,
      null,
      1100,
    );
    const pending = resolveRetaliationOpportunity(
      attackRow({
        id: 5002,
        attacker_id: 2814133,
        attacker_name: "hhk556",
        attacker_faction_name: "SMTH - High Pressure",
        defender_id: 123,
        defender_name: "Whiskas",
        result: "Hospitalized",
        attack_at: 1010,
      }),
      null,
      pendingClaim({
        opening_attack_id: 5002,
        target_id: 2814133,
        claimant_torn_user_id: 101,
        claimant_name: "Attacker",
        expires_at: 1120,
      }),
      1100,
    );
    const confirmed = resolveRetaliationOpportunity(
      attackRow({
        id: 5003,
        attacker_id: 333333,
        attacker_name: "done",
        attacker_faction_name: "Enemy Faction",
        defender_id: 123,
        defender_name: "Whiskas",
        result: "Hospitalized",
        attack_at: 1020,
      }),
      attackRow({
        id: 5004,
        attacker_id: 101,
        attacker_name: "Finisher",
        defender_id: 333333,
        result: "Hospitalized",
        m_retaliation: 2,
        attack_at: 1040,
      }),
      null,
      1100,
    );

    const payload = renderRetaliationBoardPayload([
      available,
      pending,
      confirmed,
    ], 1100);

    expect(payload.content).toBe("**Retaliation Board**\nUpdate <t:1110:R>");
    expect(payload.embeds).toEqual([
      expect.objectContaining({
        title: "nex [2054500] ⚔️",
        url: "https://www.torn.com/page.php?sid=attack&user2ID=2054500",
        description: "from [Vulpes Vulpes](https://www.torn.com/factions.php?step=profile&ID=1234)",
        color: 0xed4245,
        fields: [
          { name: "Time", value: "<t:1000:R>", inline: true },
          { name: "Timeout", value: "<t:1300:R>", inline: true },
          { name: "Defender", value: "[Whiskas](https://www.torn.com/profiles.php?XID=123)", inline: true },
          { name: "Status", value: "Open", inline: true },
          { name: "Respect", value: "2.86", inline: true },
          {
            name: "Log",
            value: "[Hospitalized](https://www.torn.com/loader.php?sid=attackLog&ID=attack-log-1)",
            inline: true,
          },
        ],
      }),
      expect.objectContaining({
        title: "hhk556 [2814133] ⚔️",
        color: 0xffa500,
        fields: expect.arrayContaining([
          { name: "Status", value: "Attack started by Attacker", inline: true },
        ]),
      }),
      expect.objectContaining({
        title: "done [333333] ⚔️",
        color: 0x57f287,
        fields: expect.arrayContaining([
          { name: "Status", value: "Retaliated by Finisher", inline: true },
        ]),
      }),
    ]);
  });

  it("renders an empty Discord board as a green status embed", () => {
    const payload = renderRetaliationBoardPayload([], 1100);

    expect(payload.content).toBe("**Retaliation Board**");
    expect(payload.embeds).toEqual([
      {
        title: "No active retaliation",
        description: "-# Update <t:1160:R>",
        color: 0x57f287,
      },
    ]);
  });

  it("uses active refresh timing while open or started retals are visible", () => {
    const available = resolveRetaliationOpportunity(
      attackRow({
        id: 5101,
        attacker_id: 2054500,
        defender_id: 123,
        attack_at: 1000,
      }),
      null,
      null,
      1100,
    );
    const pending = resolveRetaliationOpportunity(
      attackRow({
        id: 5102,
        attacker_id: 2814133,
        defender_id: 123,
        attack_at: 1010,
      }),
      null,
      pendingClaim({
        opening_attack_id: 5102,
        target_id: 2814133,
        expires_at: 1120,
      }),
      1100,
    );

    expect(getRetaliationBoardRefreshPlan([available], 1100)).toEqual({
      active: true,
      nextRefreshAt: 1110,
    });
    expect(getRetaliationBoardRefreshPlan([pending], 1100)).toEqual({
      active: true,
      nextRefreshAt: 1110,
    });
  });

  it("falls back to minutely timing for empty or confirmed-only boards", () => {
    const confirmed = resolveRetaliationOpportunity(
      attackRow({
        id: 5201,
        attacker_id: 333333,
        defender_id: 123,
        attack_at: 1000,
      }),
      attackRow({
        id: 5202,
        attacker_id: 101,
        defender_id: 333333,
        result: "Hospitalized",
        m_retaliation: 2,
        attack_at: 1040,
      }),
      null,
      1100,
    );

    expect(getRetaliationBoardRefreshPlan([], 1100)).toEqual({
      active: false,
      nextRefreshAt: 1160,
    });
    expect(getRetaliationBoardRefreshPlan([confirmed], 1100)).toEqual({
      active: false,
      nextRefreshAt: 1160,
    });
  });
});

function attackRow(overrides: Partial<RetaliationAttackRow>): RetaliationAttackRow {
  return {
    id: 1,
    code: null,
    started: null,
    ended: null,
    attacker_id: null,
    attacker_name: null,
    attacker_faction_id: null,
    attacker_faction_name: null,
    defender_id: null,
    defender_name: null,
    defender_faction_id: null,
    defender_faction_name: null,
    result: null,
    respect_gain: null,
    respect_loss: null,
    m_retaliation: null,
    attack_at: null,
    ...overrides,
  };
}

function pendingClaim(overrides: Partial<PendingRetaliationClaim>): PendingRetaliationClaim {
  return {
    opening_attack_id: 1,
    target_id: 200,
    claimant_torn_user_id: 101,
    claimant_name: "Claimer",
    source: "dashboard",
    attack_url: null,
    created_at: 1000,
    updated_at: 1000,
    expires_at: 1030,
    ...overrides,
  };
}
