import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncRetaliationDiscordBoard } from "./retaliations";
import { ingestRecentFactionAttacks } from "./ingestion";
import { refreshActiveChainWatchFromStoredAttacks } from "./chainWatch";
import { upsertDiscordAlertMessage } from "./discordAlertDelivery";
import { isDiscordAlertEnabled } from "./discordAlertSettings";
import type { Env } from "./types";

vi.mock("./ingestion", () => ({ ingestRecentFactionAttacks: vi.fn() }));
vi.mock("./chainWatch", () => ({ refreshActiveChainWatchFromStoredAttacks: vi.fn() }));
vi.mock("./discordAlertDelivery", () => ({ upsertDiscordAlertMessage: vi.fn() }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: vi.fn() }));
vi.mock("./syncState", () => ({ readSyncTimestamp: vi.fn().mockResolvedValue(0), upsertSyncTimestamp: vi.fn() }));

describe("retaliation message delivery toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDiscordAlertEnabled).mockResolvedValue(false);
    vi.mocked(ingestRecentFactionAttacks).mockResolvedValue({ inserted_attacks: 1 } as Awaited<ReturnType<typeof ingestRecentFactionAttacks>>);
  });

  it("keeps the fast attack refresh and chain updates active while suppressing Discord", async () => {
    const { env, schedule, reads, writes } = fixture(true);
    const result = await syncRetaliationDiscordBoard(env, 1100, { allowActiveLightSync: true });
    expect(result).toMatchObject({ active: true, nextRefreshAt: 1110, edited: false, skippedReason: "disabled", lightSync: { status: "refreshed" } });
    expect(ingestRecentFactionAttacks).toHaveBeenCalledWith(env, 710, 1100);
    expect(refreshActiveChainWatchFromStoredAttacks).toHaveBeenCalledWith(env, 1100);
    expect(reads.filter((sql) => sql.includes("FROM retaliation_opportunities"))).toHaveLength(2);
    expect(schedule).toHaveBeenCalledWith(1110);
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
    expect(writes.every((sql) => sql.includes("INSERT INTO sync_state"))).toBe(true);
  });

  it("still selects the ordinary idle cadence when there are no opportunities", async () => {
    const { env, schedule } = fixture(false);
    expect(await syncRetaliationDiscordBoard(env, 1100, { allowActiveLightSync: true })).toMatchObject({ active: false, nextRefreshAt: 1160, edited: false, skippedReason: "disabled" });
    expect(schedule).not.toHaveBeenCalled();
    expect(ingestRecentFactionAttacks).not.toHaveBeenCalled();
    expect(upsertDiscordAlertMessage).not.toHaveBeenCalled();
  });
});

function fixture(active: boolean) {
  const schedule = vi.fn().mockResolvedValue(undefined);
  const reads: string[] = [];
  const writes: string[] = [];
  const env = {
    RETALIATION_BOARD_ALARMS: { getByName: () => ({ schedule }) },
    DB: {
      prepare(sql: string) {
        const statement = {
          bind(..._values: unknown[]) { return statement; },
          async first() { return null; },
          async all() {
            reads.push(sql);
            return { results: active && sql.includes("FROM retaliation_opportunities") ? [{
              id: 1, attacker_id: 200, defender_id: 101, attacker_name: "Enemy", defender_name: "Home",
              attacker_faction_id: 999, defender_faction_id: 8803, result: "Hospitalized",
              started: 990, ended: 1000, attack_at: 1000,
            }] : [] };
          },
          async run() { writes.push(sql); return { meta: { changes: 1 } }; },
        };
        return statement;
      },
    },
  } as unknown as Env;
  return { env, schedule, reads, writes };
}
