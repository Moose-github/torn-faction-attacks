import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshMemberAchievementSummariesIfStale } from "./memberAchievements";
import type { Env } from "./types";

type DbCall = {
  sql: string;
  method: "all" | "first" | "run";
  params: unknown[];
};

describe("member achievement refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-23T07:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a bounded membership-aware readiness scan", async () => {
    const fixture = achievementEnv();

    await refreshMemberAchievementSummariesIfStale(fixture.env);

    const availabilityCall = fixture.calls.find((call) =>
      call.method === "all" && call.sql.includes("WITH candidate_dates")
    );
    expect(availabilityCall).toBeDefined();
    expect(availabilityCall?.sql).toContain("LIMIT ?");
    expect(availabilityCall?.sql).toContain("date('now', ?)");
    expect(availabilityCall?.sql).toContain("members.days_in_faction IS NULL");
    expect(availabilityCall?.sql).toContain("GROUP BY candidate_dates.snapshot_date");
    expect(availabilityCall?.sql).not.toContain("NOT EXISTS");
    expect(availabilityCall?.params).toEqual(["-21 days", 30, 8803]);
  });

  it("skips the maintenance stale check when it already ran in this refresh window", async () => {
    const fixture = achievementEnv({ lastCheckedAt: Date.UTC(2026, 5, 23, 6, 30, 0) / 1000 });

    const result = await refreshMemberAchievementSummariesIfStale(fixture.env);

    expect(result).toMatchObject({ skipped: true, reason: "checked this refresh window" });
    expect(fixture.calls.some((call) => call.sql.includes("WITH candidate_dates"))).toBe(false);
  });

  it("runs again in a later refresh window on the same day", async () => {
    vi.setSystemTime(new Date("2026-06-23T12:16:00.000Z"));
    const fixture = achievementEnv({ lastCheckedAt: Date.UTC(2026, 5, 23, 6, 30, 0) / 1000 });

    await refreshMemberAchievementSummariesIfStale(fixture.env);

    expect(fixture.calls.some((call) => call.sql.includes("WITH candidate_dates"))).toBe(true);
  });

  it("waits until after the daily stats window", async () => {
    vi.setSystemTime(new Date("2026-06-23T00:14:59.000Z"));
    const fixture = achievementEnv({ lastCheckedAt: Date.UTC(2026, 5, 22, 7, 0, 0) / 1000 });

    const result = await refreshMemberAchievementSummariesIfStale(fixture.env);

    expect(result).toMatchObject({ skipped: true, reason: "waiting for daily stats" });
    expect(fixture.calls.some((call) => call.sql.includes("WITH candidate_dates"))).toBe(false);
  });
});

function achievementEnv(options: { lastCheckedAt?: number } = {}): {
  env: Env;
  calls: DbCall[];
} {
  const calls: DbCall[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const statement = {
          params: [] as unknown[],
          bind(...params: unknown[]) {
            statement.params = params;
            return statement;
          },
          async first() {
            calls.push({ sql, method: "first" as const, params: statement.params });
            if (sql.includes("FROM sync_state")) {
              return options.lastCheckedAt
                ? {
                    name: "member_achievement_stale_check",
                    last_started: options.lastCheckedAt,
                    active_war_id: null,
                    war_state: "none",
                  }
                : null;
            }
            return null;
          },
          async all() {
            calls.push({ sql, method: "all" as const, params: statement.params });
            return { results: [] };
          },
          async run() {
            calls.push({ sql, method: "run" as const, params: statement.params });
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    },
  } as unknown as Env;

  return { env, calls };
}
