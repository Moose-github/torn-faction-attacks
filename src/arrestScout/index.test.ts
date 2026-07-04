import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TornKeyPoolUnavailableError extends Error {}

  return {
    fetchTrackedTornJson: vi.fn(),
    fetchTornPersonalStatsWithTimestamps: vi.fn(),
    runWithTornKeyPool: vi.fn(),
    TornKeyPoolExhaustedError: class TornKeyPoolExhaustedError extends Error {},
    TornKeyPoolUnavailableError,
  };
});

vi.mock("../personalStats", () => ({
  fetchTornPersonalStatsWithTimestamps: mocks.fetchTornPersonalStatsWithTimestamps,
}));

vi.mock("../external/torn", () => ({
  fetchTrackedTornJson: mocks.fetchTrackedTornJson,
}));

vi.mock("../tornKeyPool", () => ({
  runWithTornKeyPool: mocks.runWithTornKeyPool,
  TornKeyPoolExhaustedError: mocks.TornKeyPoolExhaustedError,
  TornKeyPoolUnavailableError: mocks.TornKeyPoolUnavailableError,
}));

import { scanArrestScout } from "./index";

describe("scanArrestScout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTrackedTornJson.mockResolvedValue({ members: [] });
    mocks.runWithTornKeyPool.mockImplementation(async (_env, options) => {
      const keyContext = {
        candidate: { keySource: "key_pool:key-1" },
        key: "submitted-key",
        keySource: "key_pool:key-1",
      };
      return {
        candidate: keyContext.candidate,
        result: await options.run(keyContext),
      };
    });
  });

  it("scans targets through the shared key pool and persists snapshot results", async () => {
    const db = new FakeArrestScoutD1();
    mocks.fetchTornPersonalStatsWithTimestamps.mockImplementation(async (_env, memberId, statKeys, options = {}) => {
      expect(statKeys).toEqual(["jailed", "counterfeiting", "forgeryskill", "fraud", "scammingskill"]);
      expect(options.apiKey).toBe("submitted-key");
      expect(options.keySource).toBe("key_pool:key-1");

      if (memberId === 111 && options.timestamp === undefined) {
        return personalStats({ counterfeiting: 1_000, jailed: 5, forgeryskill: 100 });
      }
      if (memberId === 111 && typeof options.timestamp === "number") {
        return personalStats({ counterfeiting: 400, jailed: 5, forgeryskill: 100 });
      }
      if (memberId === 222 && options.timestamp === undefined) {
        return personalStats({ counterfeiting: 10_000, jailed: 2, forgeryskill: 99 });
      }
      throw new Error(`Unexpected personalstats request for ${memberId}`);
    });

    const response = await scanArrestScout(jsonRequest({
      source: "manual",
      target_user_ids: [111, 222],
      lookback_days: 7,
      min_counterfeiting_delta: 500,
      min_fraud_delta: 250,
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checked_count).toBe(2);
    expect(body.current_target_count).toBe(1);
    expect(body.ignored_count).toBe(1);
    expect(body.current_targets).toHaveLength(1);
    expect(body.current_targets[0]).toMatchObject({
      target_user_id: 111,
      classification: "current_target",
      current_counterfeiting: 1_000,
      historical_counterfeiting: 400,
      counterfeiting_delta: 600,
      current_fraud: 0,
      historical_fraud: 0,
      fraud_delta: null,
      current_jailed: 5,
      historical_jailed: 5,
      jailed_delta: 0,
    });
    expect(body.results.map((row: any) => row.target_user_id)).toEqual([111, 222]);
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0]).toMatchObject({
      scanned_by_torn_user_id: 3238283,
      min_counterfeiting_delta: 500,
      min_fraud_delta: 250,
      target_count: 2,
      checked_count: 2,
      current_target_count: 1,
      ignored_count: 1,
      status: "ok",
    });
    expect(JSON.parse(db.snapshots[0].settings_json)).toMatchObject({
      source: "manual",
      target_user_ids: [111, 222],
      min_fraud_delta: 250,
      key_sources: ["key_pool:key-1"],
    });
    expect(db.results).toHaveLength(2);
    expect(db.results[0].current_personalstats_json).toContain("\"counterfeiting\"");
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenCalledTimes(3);
    expect(mocks.runWithTornKeyPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feature: "arrest_scout" }),
    );
  });

  it("returns a no-key response without writing a snapshot", async () => {
    const db = new FakeArrestScoutD1();
    mocks.runWithTornKeyPool.mockRejectedValue(new mocks.TornKeyPoolUnavailableError("no keys"));

    const response = await scanArrestScout(jsonRequest({
      source: "manual",
      target_user_ids: [111],
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      code: "NO_TORN_KEYS_AVAILABLE",
      error: "No eligible Torn API key is available for Arrest Scout",
    });
    expect(db.snapshots).toHaveLength(0);
    expect(db.results).toHaveLength(0);
  });

  it("treats a missing forgery skill stat as skill zero instead of an error", async () => {
    const db = new FakeArrestScoutD1();
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue({
      jailed: { value: 333, timestamp: 1_765_238_400 },
      counterfeiting: { value: 4_220, timestamp: 1_704_931_200 },
    });

    const response = await scanArrestScout(jsonRequest({
      source: "manual",
      target_user_ids: [111],
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.error_count).toBe(0);
    expect(body.ignored_count).toBe(1);
    expect(body.results[0]).toMatchObject({
      target_user_id: 111,
      classification: "ignored",
      current_forgeryskill: 0,
      current_counterfeiting: 4_220,
      current_jailed: 333,
    });
    expect(JSON.parse(body.results[0].notes_json)).toEqual([
      "forgeryskill_below_required",
      "scammingskill_below_required",
    ]);
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenCalledTimes(1);
  });

  it("uses fraud and scamming skill as a second arrest scout track", async () => {
    const db = new FakeArrestScoutD1();
    mocks.fetchTornPersonalStatsWithTimestamps.mockImplementation(async (_env, memberId, _statKeys, options = {}) => {
      if (memberId === 333 && options.timestamp === undefined) {
        return personalStats({ counterfeiting: 0, jailed: 7, forgeryskill: 0, fraud: 2_200, scammingskill: 100 });
      }
      if (memberId === 333 && typeof options.timestamp === "number") {
        return personalStats({ counterfeiting: 0, jailed: 7, forgeryskill: 0, fraud: 1_600, scammingskill: 100 });
      }
      throw new Error(`Unexpected personalstats request for ${memberId}`);
    });

    const response = await scanArrestScout(jsonRequest({
      source: "manual",
      target_user_ids: [333],
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.current_target_count).toBe(1);
    expect(body.skill_100_count).toBe(1);
    expect(body.results[0]).toMatchObject({
      target_user_id: 333,
      classification: "current_target",
      current_forgeryskill: 0,
      current_scammingskill: 100,
      current_fraud: 2_200,
      historical_fraud: 1_600,
      fraud_delta: 600,
      current_counterfeiting: 0,
      historical_counterfeiting: 0,
      counterfeiting_delta: null,
    });
    expect(JSON.parse(body.results[0].notes_json)).toEqual(["fraud_active"]);
  });

  it("scans every parsed manual target without applying a target cap", async () => {
    const db = new FakeArrestScoutD1();
    const targetIds = Array.from({ length: 55 }, (_, index) => 10_000 + index);
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(
      personalStats({ counterfeiting: 1_000, jailed: 5, forgeryskill: 99 }),
    );

    const response = await scanArrestScout(jsonRequest({
      source: "manual",
      target_user_ids: targetIds,
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.target_count).toBe(55);
    expect(body.checked_count).toBe(55);
    expect(db.results).toHaveLength(55);
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenCalledTimes(55);
  });

  it("uses arrest scout keys to scan all members from a faction source", async () => {
    const db = new FakeArrestScoutD1();
    mocks.fetchTrackedTornJson.mockResolvedValue({
      members: {
        "111": { name: "One", level: 10 },
        "222": { id: 222, name: "Two", level: 20 },
      },
    });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(
      personalStats({ counterfeiting: 1_000, jailed: 5, forgeryskill: 99 }),
    );

    const response = await scanArrestScout(jsonRequest({
      source: "faction",
      source_faction_id: 8803,
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.source_type).toBe("faction");
    expect(body.source_faction_id).toBe(8803);
    expect(body.target_count).toBe(2);
    expect(body.results.map((row: any) => row.target_user_id)).toEqual([111, 222]);
    expect(db.snapshots[0]).toMatchObject({
      source_type: "faction",
      source_faction_id: 8803,
      target_count: 2,
    });
    expect(JSON.parse(db.snapshots[0].settings_json)).toMatchObject({
      source: "faction",
      source_faction_id: 8803,
      target_user_ids: [111, 222],
      key_sources: ["key_pool:key-1"],
    });
    expect(mocks.fetchTrackedTornJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pathname: "/v2/faction/8803/members" }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "ApiKey submitted-key" }),
      }),
      expect.objectContaining({
        feature: "arrest-scout:faction-members",
        keySource: "key_pool:key-1",
      }),
      expect.anything(),
    );
    expect(mocks.runWithTornKeyPool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feature: "arrest_scout" }),
    );
  });

  it("rejects faction scans without a valid faction id", async () => {
    const db = new FakeArrestScoutD1();

    const response = await scanArrestScout(jsonRequest({
      source: "faction",
      source_faction_id: "nope",
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "INVALID_SOURCE_FACTION_ID",
    });
    expect(mocks.runWithTornKeyPool).not.toHaveBeenCalled();
    expect(db.snapshots).toHaveLength(0);
  });

  it("rechecks every due future target without applying a target cap", async () => {
    const futureTargets = Array.from({ length: 55 }, (_, index) => ({ target_user_id: 20_000 + index }));
    const db = new FakeArrestScoutD1({ futureTargets });
    mocks.fetchTornPersonalStatsWithTimestamps.mockResolvedValue(
      personalStats({ counterfeiting: 1_000, jailed: 5, forgeryskill: 99 }),
    );

    const response = await scanArrestScout(jsonRequest({
      source: "future_targets_due",
    }), { DB: db } as any, 3238283);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.target_count).toBe(55);
    expect(body.checked_count).toBe(55);
    expect(db.results).toHaveLength(55);
    expect(mocks.fetchTornPersonalStatsWithTimestamps).toHaveBeenCalledTimes(55);
    expect(db.preparedSql.some((sql) => sql.includes("FROM arrest_scout_future_targets") && sql.includes("LIMIT"))).toBe(false);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/arrest-scout/scan", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function personalStats(values: {
  counterfeiting: number;
  jailed: number;
  forgeryskill: number;
  fraud?: number;
  scammingskill?: number;
}) {
  return {
    counterfeiting: { value: values.counterfeiting, timestamp: 1_800_000_000 },
    jailed: { value: values.jailed, timestamp: 1_800_000_000 },
    forgeryskill: { value: values.forgeryskill, timestamp: 1_800_000_000 },
    fraud: { value: values.fraud ?? 0, timestamp: 1_800_000_000 },
    scammingskill: { value: values.scammingskill ?? 0, timestamp: 1_800_000_000 },
  };
}

class FakeArrestScoutD1Statement {
  args: unknown[] = [];

  constructor(
    readonly db: FakeArrestScoutD1,
    readonly sql: string,
  ) {}

  bind(...args: unknown[]) {
    this.args = args;
    return this;
  }

  async all<T>() {
    if (this.sql.includes("FROM arrest_scout_results")) {
      return { results: this.db.results as T[] };
    }
    if (this.sql.includes("FROM arrest_scout_snapshots")) {
      return { results: this.db.snapshots as T[] };
    }
    if (this.sql.includes("FROM arrest_scout_future_targets")) {
      return { results: this.db.futureTargets as T[] };
    }
    return { results: [] as T[] };
  }

  async first<T>() {
    if (this.sql.includes("FROM arrest_scout_snapshots")) {
      return (this.db.snapshots.find((snapshot) => snapshot.id === this.args[0]) ?? null) as T | null;
    }
    return null as T | null;
  }

  async run() {
    this.db.applyStatement(this);
    return {};
  }
}

class FakeArrestScoutD1 {
  snapshots: any[] = [];
  results: any[] = [];
  futureTargets: Array<{ target_user_id: number }> = [];
  preparedSql: string[] = [];

  constructor(options: { futureTargets?: Array<{ target_user_id: number }> } = {}) {
    this.futureTargets = options.futureTargets ?? [];
  }

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new FakeArrestScoutD1Statement(this, sql);
  }

  async batch(statements: FakeArrestScoutD1Statement[]) {
    for (const statement of statements) {
      this.applyStatement(statement);
    }
    return statements.map(() => ({}));
  }

  applyStatement(statement: FakeArrestScoutD1Statement) {
    if (statement.sql.includes("INSERT INTO arrest_scout_snapshots")) {
      this.snapshots.push(snapshotFromArgs(statement.args));
    } else if (statement.sql.includes("INSERT INTO arrest_scout_results")) {
      this.results.push(resultFromArgs(statement.args));
    }
  }
}

function snapshotFromArgs(args: unknown[]) {
  return {
    id: args[0],
    source_type: args[1],
    source_faction_id: args[2],
    scanned_by_torn_user_id: args[3],
    scanned_at: args[4],
    lookback_seconds: args[5],
    min_counterfeiting_delta: args[6],
    min_fraud_delta: args[7],
    status: args[8],
    error: args[9],
    settings_json: args[10],
    target_count: args[11],
    checked_count: args[12],
    skill_100_count: args[13],
    current_target_count: args[14],
    future_target_count: args[15],
    inactive_count: args[16],
    ignored_count: args[17],
    error_count: args[18],
  };
}

function resultFromArgs(args: unknown[]) {
  return {
    id: args[0],
    snapshot_id: args[1],
    target_user_id: args[2],
    name: args[3],
    classification: args[4],
    score: args[5],
    current_forgeryskill: args[6],
    current_counterfeiting: args[7],
    historical_counterfeiting: args[8],
    counterfeiting_delta: args[9],
    current_scammingskill: args[10],
    current_fraud: args[11],
    historical_fraud: args[12],
    fraud_delta: args[13],
    current_jailed: args[14],
    historical_jailed: args[15],
    jailed_delta: args[16],
    current_jailed_timestamp: args[17],
    current_counterfeiting_timestamp: args[18],
    current_forgeryskill_timestamp: args[19],
    current_fraud_timestamp: args[20],
    current_scammingskill_timestamp: args[21],
    historical_jailed_timestamp: args[22],
    historical_counterfeiting_timestamp: args[23],
    historical_forgeryskill_timestamp: args[24],
    historical_fraud_timestamp: args[25],
    historical_scammingskill_timestamp: args[26],
    lookback_seconds: args[27],
    historical_timestamp_requested: args[28],
    notes_json: args[29],
    current_personalstats_json: args[30],
    historical_personalstats_json: args[31],
    created_at: args[32],
  };
}
