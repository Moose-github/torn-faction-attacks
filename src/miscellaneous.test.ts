import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDiscordAlertMessage } from "./discordAlertDelivery";
import { readShopliftingSecurityAlertSettings } from "./discordAlertSettings";
import { fetchTrackedTornJson } from "./external/torn";
import { getMiscellaneousData, refreshTornShoplifting } from "./miscellaneous";
import { clearSyncLatch, readSetSyncLatches, setSyncLatch } from "./syncLatches";
import type { Env } from "./types";

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({
  withTornKeyPool: (_env: Env, options: { run: (context: unknown) => Promise<unknown> }) =>
    options.run({ key: "test-key", keySource: "test" }),
}));
vi.mock("./discordAlertDelivery", () => ({ sendDiscordAlertMessage: vi.fn() }));
vi.mock("./discordAlertSettings", async (importOriginal) => ({
  ...await importOriginal<typeof import("./discordAlertSettings")>(),
  readShopliftingSecurityAlertSettings: vi.fn(),
}));
vi.mock("./discordMentions", async (importOriginal) => ({
  ...await importOriginal<typeof import("./discordMentions")>(),
  readDiscordAlertMentions: vi.fn(async () => ({ messageSuffix: "", allowedMentions: undefined })),
}));
vi.mock("./syncLatches", () => ({
  clearSyncLatch: vi.fn(),
  readSetSyncLatches: vi.fn(),
  setSyncLatch: vi.fn(),
}));

const bigAlsAlert = "shoplifting_security_alert:big_als";
const securitiesDown = [
  { title: "Four cameras", disabled: true },
  { title: "Two guards", disabled: true },
];
const shoplifting = {
  big_als: securitiesDown,
  jewelry_store: [
    { title: "Three cameras", disabled: false },
    { title: "One guard", disabled: true },
  ],
};

describe("shoplifting refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ shoplifting });
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set());
    vi.mocked(readShopliftingSecurityAlertSettings).mockResolvedValue([
      { shop_key: "big_als", shop_name: "Big Als", enabled: true, configurable: true },
      { shop_key: "jewelry_store", shop_name: "Jewelry Store", enabled: true, configurable: true },
    ]);
    vi.mocked(sendDiscordAlertMessage).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("explicitly requests the supported shop-name response and caches its statuses", async () => {
    const env = fakeEnv();

    await expect(refreshTornShoplifting(env)).resolves.toMatchObject({ ok: true, shops: 2, alerts_sent: 1 });

    const url = new URL(String(vi.mocked(fetchTrackedTornJson).mock.calls[0][1]));
    expect(url.searchParams.get("selections")).toBe("shoplifting");
    expect(url.searchParams.get("legacy")).toBe("shoplifting");
    await expect((await getMiscellaneousData(env)).json()).resolves.toMatchObject({
      ok: true,
      shoplifting,
      fetched_at: Math.floor(Date.now() / 1000),
      error: null,
    });
    expect(sendDiscordAlertMessage).toHaveBeenCalledWith(env, bigAlsAlert,
      expect.stringContaining("all securities are down at Big Als"), undefined);
    expect(setSyncLatch).toHaveBeenCalledWith(env, bigAlsAlert, Math.floor(Date.now() / 1000));
  });

  it.each([
    { label: "new ID-based API response", value: [{ id: 1, status: securitiesDown }] },
    { label: "missing selection", value: undefined },
    { label: "empty selection", value: {} },
    { label: "invalid shop entry", value: { big_als: { status: securitiesDown } } },
    { label: "empty security list", value: { big_als: [] } },
    { label: "string boolean", value: { big_als: [{ title: "Four cameras", disabled: "false" }] } },
    { label: "null obstacle", value: { big_als: [null] } },
    { label: "missing title", value: { big_als: [{ disabled: true }] } },
  ])("preserves the last good snapshot and alert latch for $label", async ({ value }) => {
    const env = fakeEnv();
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ shoplifting: value });
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set([bigAlsAlert]));

    await expect(refreshTornShoplifting(env)).resolves.toMatchObject({ ok: false });
    await expect((await getMiscellaneousData(env)).json()).resolves.toMatchObject({
      shoplifting,
      fetched_at: 100,
      error: expect.stringContaining("Invalid Torn shoplifting"),
    });
    expect(sendDiscordAlertMessage).not.toHaveBeenCalled();
    expect(setSyncLatch).not.toHaveBeenCalled();
    expect(clearSyncLatch).not.toHaveBeenCalled();
  });

  it("does not suppress retries when Discord has no delivery route", async () => {
    const env = fakeEnv();
    vi.mocked(sendDiscordAlertMessage).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(refreshTornShoplifting(env)).resolves.toMatchObject({ alerts_sent: 0 });
    expect(setSyncLatch).not.toHaveBeenCalled();

    await expect(refreshTornShoplifting(env)).resolves.toMatchObject({ alerts_sent: 1 });
    expect(setSyncLatch).toHaveBeenCalledTimes(1);
  });

  it("sends once per downtime and rearms when security returns", async () => {
    const env = fakeEnv();
    const latches = new Set<string>();
    vi.mocked(readSetSyncLatches).mockImplementation(async () => new Set(latches));
    vi.mocked(setSyncLatch).mockImplementation(async (_env, key) => { latches.add(key); });
    vi.mocked(clearSyncLatch).mockImplementation(async (_env, key) => {
      latches.delete(key);
      return {} as D1Result;
    });

    await refreshTornShoplifting(env);
    await refreshTornShoplifting(env);
    expect(sendDiscordAlertMessage).toHaveBeenCalledTimes(1);

    vi.mocked(fetchTrackedTornJson).mockResolvedValueOnce({
      shoplifting: { ...shoplifting, big_als: [{ title: "Four cameras", disabled: false }, securitiesDown[1]] },
    });
    await refreshTornShoplifting(env);
    expect(latches.has(bigAlsAlert)).toBe(false);
    await refreshTornShoplifting(env);
    expect(sendDiscordAlertMessage).toHaveBeenCalledTimes(2);
  });

  it("does not rearm an alert when its shop is absent from a partial response", async () => {
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set([bigAlsAlert]));
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ shoplifting: { jewelry_store: shoplifting.jewelry_store } });

    await refreshTornShoplifting(fakeEnv());

    expect(clearSyncLatch).not.toHaveBeenCalled();
  });

  it("does not send disabled alerts and clears their previous latch", async () => {
    vi.mocked(readShopliftingSecurityAlertSettings).mockResolvedValue([
      { shop_key: "big_als", shop_name: "Big Als", enabled: false, configurable: true },
    ]);
    vi.mocked(readSetSyncLatches).mockResolvedValue(new Set([bigAlsAlert]));
    const env = fakeEnv();

    await refreshTornShoplifting(env);

    expect(sendDiscordAlertMessage).not.toHaveBeenCalled();
    expect(clearSyncLatch).toHaveBeenCalledWith(env, bigAlsAlert);
  });

  it("keeps refreshed statuses available when Discord fails without marking the alert sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendDiscordAlertMessage).mockRejectedValue(new Error("missing access"));
    const env = fakeEnv();

    await expect(refreshTornShoplifting(env)).resolves.toMatchObject({
      ok: true, shops: 2, alert_error: "missing access",
    });
    await expect((await getMiscellaneousData(env)).json()).resolves.toMatchObject({ shoplifting, error: null });
    expect(setSyncLatch).not.toHaveBeenCalled();
  });
});

function fakeEnv(): Env {
  let row = { data_json: JSON.stringify(shoplifting), fetched_at: 100, error: null as string | null };
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              first: async () => row,
              run: async () => {
                if (sql.includes("data_json = excluded.data_json")) {
                  row = { data_json: String(values[1]), fetched_at: Number(values[2]), error: null };
                } else if (sql.includes("error = excluded.error")) {
                  row.error = String(values[1]);
                } else {
                  throw new Error(`Unexpected SQL: ${sql}`);
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
}
