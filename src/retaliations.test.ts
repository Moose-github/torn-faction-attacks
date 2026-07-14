import { describe, expect, it } from "vitest";
import {
  evaluateRetaliationAvailability,
  getRetaliationCheck,
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
    expect(availability.enemy_attack).toBeNull();
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
