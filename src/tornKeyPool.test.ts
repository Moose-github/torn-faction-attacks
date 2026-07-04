import { describe, expect, it } from "vitest";
import { ExternalApiError } from "./external/http";
import {
  allowedFeaturesFromJson,
  decryptTornApiKey,
  encryptTornApiKey,
  featureAccessRequirement,
  fingerprintTornApiKey,
  isFeatureAllowed,
  isRetryableTornKeyError,
  isTornKeyCapableForFeature,
  isUnderMinuteLimit,
  readTornBasicOwnerName,
  runWithTornKeyPool,
  sortCandidatesForFeature,
  TornKeyPoolUnavailableError,
  type TornKeyPoolCandidate,
  type TornKeyPoolRow,
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

  it("runs with the admin fallback key when no submitted keys are configured", async () => {
    const output = await runWithTornKeyPool(envWithFallback("fallback-key"), {
      feature: "arrest_scout",
      now: 1000,
      run: async ({ key, keySource }) => ({ key, keySource }),
    });

    expect(output.result).toEqual({ key: "fallback-key", keySource: "env:TORN_API_KEY" });
    expect(output.candidate.sourceType).toBe("env");
  });

  it("throws a clear error when no key is available", async () => {
    await expect(runWithTornKeyPool(envWithFallback(""), {
      feature: "arrest_scout",
      now: 1000,
      run: async () => "never",
    })).rejects.toBeInstanceOf(TornKeyPoolUnavailableError);
  });

  it("records submitted key usage after successful work", async () => {
    const encrypted = await encryptTornApiKey("submitted-key", "storage-secret");
    const db = new FakeD1([
      keyRow({ id: "key-1", encrypted_key: encrypted }),
    ]);

    const output = await runWithTornKeyPool(fakeEnv({ DB: db, TORN_KEY_STORAGE_SECRET: "storage-secret" }), {
      feature: "arrest_scout",
      now: 1234,
      run: async ({ key }) => key,
    });

    expect(output.result).toBe("submitted-key");
    expect(db.batchCalls).toHaveLength(1);
    expect(db.batchCalls[0].map((statement) => statement.sql)).toEqual([
      expect.stringContaining("INSERT INTO torn_api_key_usage_windows"),
      expect.stringContaining("UPDATE torn_api_keys"),
    ]);
  });

  it("pauses a submitted key on retryable key failure and tries the next candidate", async () => {
    const db = new FakeD1([
      keyRow({ id: "bad-key", encrypted_key: await encryptTornApiKey("bad", "storage-secret") }),
      keyRow({ id: "good-key", encrypted_key: await encryptTornApiKey("good", "storage-secret") }),
    ]);

    const output = await runWithTornKeyPool(fakeEnv({ DB: db, TORN_KEY_STORAGE_SECRET: "storage-secret" }), {
      feature: "arrest_scout",
      now: 1234,
      run: async ({ key }) => {
        if (key === "bad") {
          throw new ExternalApiError("Torn request failed with HTTP 429", "Torn", 429);
        }
        return key;
      },
    });

    expect(output.result).toBe("good");
    expect(db.runCalls.some((call) => call.sql.includes("failure_count = failure_count + 1"))).toBe(true);
    expect(db.batchCalls).toHaveLength(1);
  });

  it("classifies key and rate limit errors as retryable", () => {
    expect(isRetryableTornKeyError(new ExternalApiError("rate limited", "Torn", 429))).toBe(true);
    expect(isRetryableTornKeyError(new Error("Torn API error: Incorrect key"))).toBe(true);
    expect(isRetryableTornKeyError(new ExternalApiError("bad request", "Torn", 400))).toBe(false);
  });

  it("reads owner names from Torn user basic response shapes", () => {
    expect(readTornBasicOwnerName({ name: "Dara", id: 3238283 }, 3238283)).toBe("Dara");
    expect(readTornBasicOwnerName({ profile: { name: "Moose", player_id: 3238283 } }, 3238283)).toBe("Moose");
    expect(readTornBasicOwnerName({ user: { username: "Wrong", id: 111 } }, 3238283)).toBeNull();
    expect(readTornBasicOwnerName({ basic: { player_name: "Fallback" } }, 3238283)).toBe("Fallback");
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

function envWithFallback(key: string): any {
  return fakeEnv({ TORN_API_KEY: key });
}

function fakeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    DB: new FakeD1([]),
    ...overrides,
  };
}

function keyRow(overrides: Partial<TornKeyPoolRow> = {}): TornKeyPoolRow {
  return {
    id: "key",
    label: null,
    encrypted_key: "",
    key_fingerprint: "fingerprint",
    submitted_by_torn_user_id: 1,
    owner_torn_user_id: 1,
    owner_name: "User",
    access_level: 1,
    access_type: "Public",
    faction_access: 0,
    status: "active",
    allowed_features_json: JSON.stringify(["arrest_scout"]),
    max_requests_per_minute: null,
    last_validated_at: null,
    last_used_at: null,
    last_used_feature: null,
    monitor_last_used_at: null,
    paused_until: null,
    failure_count: 0,
    last_error: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

class FakeD1Statement {
  args: unknown[] = [];

  constructor(
    readonly db: FakeD1,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all<T>() {
    if (this.sql.includes("FROM torn_api_keys k")) {
      return {
        results: this.db.rows.map((row) => ({
          ...row,
          current_request_count: 0,
        })),
      } as { results: T[] };
    }
    return { results: [] as T[] };
  }

  async first<T>() {
    return null as T | null;
  }

  async run() {
    this.db.runCalls.push({ sql: this.sql, args: this.args });
    return {};
  }
}

class FakeD1 {
  runCalls: Array<{ sql: string; args: unknown[] }> = [];
  batchCalls: FakeD1Statement[][] = [];

  constructor(readonly rows: TornKeyPoolRow[]) {}

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]) {
    this.batchCalls.push(statements);
    return statements.map(() => ({}));
  }
}
