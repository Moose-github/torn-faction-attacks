import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, TornFactionMember } from "../types";

const mocks = vi.hoisted(() => ({
  fetchTornFactionMembers: vi.fn(),
}));

vi.mock("../enemyScouting", () => ({
  fetchTornFactionMembers: mocks.fetchTornFactionMembers,
}));

import { syncHomeFactionMemberList } from "./internal";

type PreparedCall = {
  sql: string;
  params: unknown[];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("home faction member sync", () => {
  it("tracks current stint join dates without replacing ongoing members", async () => {
    mocks.fetchTornFactionMembers.mockResolvedValue([
      {
        id: 3889541,
        name: "Lupoxx",
        level: 100,
        position: "Member",
        days_in_faction: 162,
      } satisfies Partial<TornFactionMember>,
    ]);
    const preparedCalls: PreparedCall[] = [];
    const env = testEnv(preparedCalls);

    await syncHomeFactionMemberList(env);

    const rosterUpsert = preparedCalls.find((call) =>
      call.sql.includes("INSERT INTO home_faction_members")
    );
    expect(rosterUpsert?.sql).toContain("current_join_date");
    expect(rosterUpsert?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, 1, date('now'), unixepoch())");
    expect(rosterUpsert?.sql).toContain("WHEN home_faction_members.is_current = 0 THEN excluded.current_join_date");
    expect(rosterUpsert?.sql).toContain("ELSE COALESCE(home_faction_members.current_join_date, excluded.current_join_date)");
    expect(rosterUpsert?.params).toEqual([3889541, 8803, "Lupoxx", 100, "Member", 162]);
  });
});

function testEnv(preparedCalls: PreparedCall[]): Env {
  return {
    DB: {
      prepare(sql: string) {
        const compactSql = sql.replace(/\s+/g, " ").trim();
        const statement = {
          params: [] as unknown[],
          bind(...params: unknown[]) {
            statement.params = params;
            preparedCalls.push({ sql: compactSql, params });
            return statement;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
      async batch(statements: Array<{ run?: () => Promise<unknown> }>) {
        for (const statement of statements) {
          await statement.run?.();
        }
        return statements.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
}
