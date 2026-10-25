import { describe, expect, it, vi } from "vitest";
import { encryptTornApiKey } from "../../../src/tornKeyPool";
import { markMonitorKeyFailure, readMonitorKeyCandidates, recordMonitorKeyUsage } from "./keyPool";
import type { MonitorEnv } from "./types";

const now = 1_800_000_000;

function keyRow(overrides: Record<string, unknown>) {
  return {
    id: "pool-key-1",
    encrypted_key: "",
    allowed_features_json: '["hospital_monitor"]',
    access_level: 1,
    access_type: "Public Only",
    faction_access: 0,
    max_requests_per_minute: 30,
    last_used_at: null,
    monitor_last_used_at: null,
    paused_until: null,
    current_request_count: 0,
    ...overrides,
  };
}

function monitorEnv(options: { rows?: unknown[]; failPoolRead?: boolean } = {}) {
  const runs: Array<{ sql: string; params: unknown[] }> = [];
  const statement = (sql: string) => {
    let params: unknown[] = [];
    return {
      bind(...values: unknown[]) { params = values; return this; },
      async all() {
        if (options.failPoolRead) throw new Error("D1 unavailable");
        return { results: options.rows ?? [] };
      },
      async run() { runs.push({ sql, params }); return { meta: { changes: 1 } }; },
    };
  };
  const env = {
    DB: {
      prepare: vi.fn(statement),
      batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((item) => item.run()))),
    },
    TORN_API_KEY: "fallback-key",
    TORN_KEY_STORAGE_SECRET: "storage-secret",
  } as unknown as MonitorEnv;
  return { env, runs };
}

describe("hospital monitor key pool adapter", () => {
  it("returns pool keys first and the fallback key last, in the monitor's shape", async () => {
    const { env } = monitorEnv({
      rows: [keyRow({ encrypted_key: await encryptTornApiKey("pool-secret-key", "storage-secret") })],
    });

    const candidates = await readMonitorKeyCandidates(env, now);

    expect(candidates).toEqual([
      expect.objectContaining({ id: "pool-key-1", key: "pool-secret-key", alias: "pool:pool-key", sourceType: "submitted" }),
      expect.objectContaining({ id: "env:TORN_API_KEY", key: "fallback-key", alias: "admin-fallback", sourceType: "secret" }),
    ]);
  });

  it("skips pool keys that do not allow the hospital monitor", async () => {
    const { env } = monitorEnv({
      rows: [keyRow({
        allowed_features_json: '["enemy_scouting"]',
        encrypted_key: await encryptTornApiKey("pool-secret-key", "storage-secret"),
      })],
    });

    expect((await readMonitorKeyCandidates(env, now)).map((candidate) => candidate.id)).toEqual(["env:TORN_API_KEY"]);
  });

  it("keeps the fallback key when the pool cannot be read", async () => {
    const { env } = monitorEnv({ failPoolRead: true });

    expect((await readMonitorKeyCandidates(env, now)).map((candidate) => candidate.id)).toEqual(["env:TORN_API_KEY"]);
  });

  it("records usage and failures only for pool keys", async () => {
    const { env, runs } = monitorEnv();
    const fallback = { id: "env:TORN_API_KEY", key: "k", alias: "admin-fallback", sourceType: "secret" as const, keySource: "env:TORN_API_KEY", maxRequestsPerMinute: null, currentMinuteUsage: 0, lastUsedAt: null };
    const pooled = { ...fallback, id: "pool-key-1", alias: "pool:pool-key", sourceType: "submitted" as const, keySource: "key_pool:pool-key-1" };

    await recordMonitorKeyUsage(env, fallback, now, 3);
    await markMonitorKeyFailure(env, fallback, "rate limited", now, 60);
    expect(runs).toEqual([]);

    await recordMonitorKeyUsage(env, pooled, now, 3);
    await markMonitorKeyFailure(env, pooled, "rate limited", now, 0);
    expect(runs.map((run) => run.params)).toEqual([
      ["pool-key-1", now - (now % 60), 3],
      [now, "hospital_monitor", "hospital_monitor", now, now, "pool-key-1"],
      ["rate limited", now + 1, now, "pool-key-1"],
    ]);
  });
});
