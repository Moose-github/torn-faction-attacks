import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrackedTornJson } from "./external/torn";
import {
  normalizeDiscordLink,
  syncMemberDiscordLinks,
} from "./memberDiscordLinks";
import type { Env } from "./types";

vi.mock("./external/torn", () => ({
  fetchTrackedTornJson: vi.fn(),
}));

describe("member Discord links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes valid Torn Discord lookup responses", () => {
    expect(normalizeDiscordLink({
      discord: {
        userID: 148747,
        discordID: "1168319686270795856",
      },
    }, 148747)).toEqual({
      tornUserId: 148747,
      discordUserId: "1168319686270795856",
    });
  });

  it("rejects missing, mismatched, or invalid Discord IDs", () => {
    expect(normalizeDiscordLink({ discord: { userID: 1, discordID: "" } }, 1)).toBeNull();
    expect(normalizeDiscordLink({ discord: { userID: 2, discordID: "1168319686270795856" } }, 1)).toBeNull();
    expect(normalizeDiscordLink({ discord: { userID: 1, discordID: "not-discord" } }, 1)).toBeNull();
  });

  it("syncs current home member Discord IDs and skips invalid responses", async () => {
    vi.mocked(fetchTrackedTornJson)
      .mockResolvedValueOnce({ discord: { userID: 1, discordID: "111111111111111111" } })
      .mockResolvedValueOnce({ discord: { userID: 2, discordID: "" } })
      .mockResolvedValueOnce({ discord: { userID: 3, discordID: "333333333333333333" } });

    const env = fakeEnv([
      { member_id: 1, name: "Alice" },
      { member_id: 2, name: "Bob" },
      { member_id: 3, name: "Cara" },
    ]);

    await expect(syncMemberDiscordLinks(env)).resolves.toEqual({
      fetched: 3,
      linked: 2,
      skipped: 1,
      failed: 0,
      changedRows: 2,
    });
    expect(env.insertedLinks).toEqual([
      [1, "111111111111111111"],
      [3, "333333333333333333"],
    ]);
    expect(fetchTrackedTornJson).toHaveBeenCalledWith(
      env,
      expect.any(URL),
      { headers: { Accept: "application/json" } },
      expect.objectContaining({ feature: "discord-links", keySource: "env:TORN_API_KEY" }),
      { service: "Torn Discord lookup" },
    );
  });

  it("continues syncing after individual Torn lookup failures", async () => {
    vi.mocked(fetchTrackedTornJson)
      .mockRejectedValueOnce(new Error("Torn down"))
      .mockResolvedValueOnce({ discord: { userID: 2, discordID: "222222222222222222" } });

    const env = fakeEnv([
      { member_id: 1, name: "Alice" },
      { member_id: 2, name: "Bob" },
    ]);

    await expect(syncMemberDiscordLinks(env)).resolves.toMatchObject({
      fetched: 2,
      linked: 1,
      skipped: 0,
      failed: 1,
      changedRows: 1,
    });
    expect(env.insertedLinks).toEqual([[2, "222222222222222222"]]);
  });
});

type FakeEnv = Env & {
  insertedLinks: Array<[number, string]>;
};

function fakeEnv(members: Array<{ member_id: number; name: string }>): FakeEnv {
  const insertedLinks: Array<[number, string]> = [];
  return {
    TORN_API_KEY: "torn-key",
    insertedLinks,
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return statement(sql, values);
          },
          all() {
            return Promise.resolve({ results: members });
          },
        };
      },
      batch(statements: Array<{ run: () => Promise<unknown> }>) {
        return Promise.all(statements.map((item) => item.run()));
      },
    },
  } as unknown as FakeEnv;

  function statement(sql: string, values: unknown[]) {
    return {
      all() {
        return Promise.resolve({ results: members });
      },
      run() {
        if (sql.includes("INSERT INTO discord_member_links")) {
          insertedLinks.push([Number(values[0]), String(values[1])]);
        }
        return Promise.resolve({ meta: { changes: 1 } });
      },
    };
  }
}
