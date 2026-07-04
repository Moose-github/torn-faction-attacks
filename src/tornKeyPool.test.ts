import { describe, expect, it } from "vitest";
import {
  allowedFeaturesFromJson,
  decryptTornApiKey,
  encryptTornApiKey,
  featureAccessRequirement,
  fingerprintTornApiKey,
  isFeatureAllowed,
  isTornKeyCapableForFeature,
  isUnderMinuteLimit,
  sortCandidatesForFeature,
  type TornKeyPoolCandidate,
} from "./tornKeyPool";

describe("torn key pool", () => {
  it("encrypts and decrypts Torn keys without preserving plaintext", async () => {
    const encrypted = await encryptTornApiKey("abc123-secret-key", "storage-secret");

    expect(encrypted).not.toContain("abc123-secret-key");
    await expect(decryptTornApiKey(encrypted, "storage-secret")).resolves.toBe("abc123-secret-key");
  });

  it("creates stable duplicate-detection fingerprints", async () => {
    const first = await fingerprintTornApiKey("same-key", "storage-secret");
    const second = await fingerprintTornApiKey("same-key", "storage-secret");
    const third = await fingerprintTornApiKey("different-key", "storage-secret");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("filters allowed features from stored JSON", () => {
    const json = JSON.stringify([
      "arrest_scout",
      "hospital_monitor",
      "experimental_features",
      "faction_lifestyle_stats",
      "not_real",
    ]);

    expect(allowedFeaturesFromJson(json)).toEqual([
      "arrest_scout",
      "hospital_monitor",
      "experimental_features",
      "faction_lifestyle_stats",
    ]);
    expect(isFeatureAllowed(json, "hospital_monitor")).toBe(true);
    expect(isFeatureAllowed(json, "experimental_features")).toBe(true);
    expect(isFeatureAllowed(json, "stock_tools")).toBe(false);
  });

  it("maps legacy permissions to split key-spending permissions", () => {
    expect(allowedFeaturesFromJson(JSON.stringify(["background_stats"]))).toEqual(["faction_lifestyle_stats"]);
    expect(allowedFeaturesFromJson(JSON.stringify(["faction_stats"]))).toEqual([
      "faction_lifestyle_stats",
      "faction_contributor_stats",
    ]);
    expect(allowedFeaturesFromJson(JSON.stringify(["war_tools"]))).toEqual(["war_live_data"]);
  });

  it("checks stored key capabilities by feature", () => {
    const publicKey = { access_level: 1, access_type: "Custom", faction_access: 0 };
    const factionKey = { access_level: 1, access_type: "Custom", faction_access: 1 };
    const fullKey = { access_level: null, access_type: "Full", faction_access: 0 };
    const noPublicAccessKey = { access_level: null, access_type: "Custom", faction_access: 0 };

    expect(isTornKeyCapableForFeature(publicKey, "arrest_scout")).toBe(true);
    expect(isTornKeyCapableForFeature(publicKey, "faction_lifestyle_stats")).toBe(true);
    expect(isTornKeyCapableForFeature(publicKey, "war_live_data")).toBe(false);
    expect(isTornKeyCapableForFeature(publicKey, "faction_contributor_stats")).toBe(false);
    expect(isTornKeyCapableForFeature(factionKey, "war_live_data")).toBe(true);
    expect(isTornKeyCapableForFeature(factionKey, "faction_contributor_stats")).toBe(true);
    expect(isTornKeyCapableForFeature(fullKey, "war_live_data")).toBe(true);
    expect(isTornKeyCapableForFeature(noPublicAccessKey, "stock_tools")).toBe(false);
  });

  it("marks feature access requirements", () => {
    expect(featureAccessRequirement("war_live_data")).toBe("faction");
    expect(featureAccessRequirement("faction_contributor_stats")).toBe("faction");
    expect(featureAccessRequirement("faction_lifestyle_stats")).toBe("public");
    expect(featureAccessRequirement("hospital_monitor")).toBe("public");
    expect(featureAccessRequirement("stock_tools")).toBe("public");
  });

  it("enforces per-minute key limits", () => {
    expect(isUnderMinuteLimit(4, 5)).toBe(true);
    expect(isUnderMinuteLimit(5, 5)).toBe(false);
    expect(isUnderMinuteLimit(500, null)).toBe(true);
  });

  it("prioritizes hospital monitor keys ahead of recently monitor-used keys for background work", () => {
    const candidates: TornKeyPoolCandidate[] = [
      candidate("recent-monitor", 990),
      candidate("quiet", 100),
    ];

    expect(sortCandidatesForFeature(candidates, "arrest_scout", 1000)[0].id).toBe("quiet");
    expect(sortCandidatesForFeature(candidates, "hospital_monitor", 1000)[0].id).toBe("quiet");
  });
});

function candidate(id: string, monitorLastUsedAt: number): TornKeyPoolCandidate {
  return {
    id,
    key: `${id}-key`,
    keySource: `key_pool:${id}`,
    sourceType: "submitted",
    maxRequestsPerMinute: null,
    currentMinuteUsage: 0,
    lastUsedAt: monitorLastUsedAt,
    monitorLastUsedAt,
  };
}
