import { describe, expect, it } from "vitest";
import {
  allowedFeaturesFromJson,
  decryptTornApiKey,
  encryptTornApiKey,
  fingerprintTornApiKey,
  isFeatureAllowed,
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
    const json = JSON.stringify(["arrest_scout", "hospital_monitor", "not_real"]);

    expect(allowedFeaturesFromJson(json)).toEqual(["arrest_scout", "hospital_monitor"]);
    expect(isFeatureAllowed(json, "hospital_monitor")).toBe(true);
    expect(isFeatureAllowed(json, "background_stats")).toBe(false);
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
