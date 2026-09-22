import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_FACTION_ID } from "./constants";
import { handleChainWatchAlarm, readChainWatchState, type ChainWatchStateRow } from "./chainWatch";
import { ChainWatchAlarm } from "./chainWatchAlarm";
import { handleWatchCheckInAlarm } from "./chainWatchCheckIns";
import type { Env } from "./types";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {
  constructor(public ctx: DurableObjectState, public env: Env) {}
} }));
vi.mock("./chainWatch", () => ({ handleChainWatchAlarm: vi.fn().mockResolvedValue(undefined), readChainWatchState: vi.fn() }));
vi.mock("./chainWatchCheckIns", () => ({ handleWatchCheckInAlarm: vi.fn().mockResolvedValue(null) }));

describe("faction alarm ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(readChainWatchState).mockResolvedValue(null); });
  function scheduled(at: number): ChainWatchStateRow {
    return { enabled: 1, scheduled_alarm_at: at, scheduled_alarm_stage: "warning_60", timer_version: 2 } as ChainWatchStateRow;
  }
  function object() {
    const values = new Map<string, unknown>();
    const storage = {
      get: vi.fn(async (key: string) => values.get(key)),
      put: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
      delete: vi.fn(async (key: string) => values.delete(key)),
      setAlarm: vi.fn(), deleteAlarm: vi.fn(),
    };
    const env = {} as Env;
    let queue = Promise.resolve();
    const blockConcurrencyWhile = (fn: () => Promise<void>) => {
      const next = queue.then(fn);
      queue = next.catch(() => {});
      return next;
    };
    return { values, storage, env, alarm: new ChainWatchAlarm({ storage, blockConcurrencyWhile } as unknown as DurableObjectState, env) };
  }
  it("retires legacy war alarms without invoking the faction monitor", async () => {
    const { values, storage, alarm } = object(); values.set("warId", HOME_FACTION_ID);
    await alarm.alarm();
    expect(handleChainWatchAlarm).not.toHaveBeenCalled();
    expect(storage.deleteAlarm).toHaveBeenCalled();
    expect(values.size).toBe(0);
  });
  it("ignores late legacy schedule RPCs", async () => {
    const { storage, alarm } = object();
    await alarm.schedule();
    expect(storage.deleteAlarm).toHaveBeenCalled();
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });
  it("schedules and handles the faction alarm", async () => {
    const { env, values, storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 60;
    vi.mocked(readChainWatchState).mockResolvedValue(scheduled(at));
    await alarm.syncFaction(HOME_FACTION_ID);
    expect(values.get("factionId")).toBe(HOME_FACTION_ID);
    expect(storage.setAlarm).toHaveBeenCalledWith(at * 1000);
    await alarm.alarm();
    expect(handleChainWatchAlarm).toHaveBeenCalledExactlyOnceWith(env, HOME_FACTION_ID);
  });
  it("ignores old RPC deadlines and cancellations while a newer schedule is active", async () => {
    const { storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 300;
    vi.mocked(readChainWatchState).mockResolvedValue(scheduled(at));
    await alarm.scheduleFaction(HOME_FACTION_ID, at - 200);
    await alarm.cancel();
    expect(storage.setAlarm).toHaveBeenLastCalledWith(at * 1000);
    expect(storage.deleteAlarm).not.toHaveBeenCalled();
    vi.mocked(readChainWatchState).mockResolvedValue({ ...scheduled(at), enabled: 0 });
    await alarm.syncFaction(HOME_FACTION_ID);
    expect(storage.deleteAlarm).toHaveBeenCalledOnce();
  });
  it("serializes concurrent schedule reads so the latest request wins", async () => {
    const { storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 300;
    let release!: (value: ChainWatchStateRow) => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(readChainWatchState).mockImplementationOnce(() => {
      started(); return new Promise(resolve => { release = resolve; });
    }).mockResolvedValue(scheduled(at));
    const first = alarm.syncFaction(HOME_FACTION_ID);
    await reading;
    const second = alarm.syncFaction(HOME_FACTION_ID);
    expect(readChainWatchState).toHaveBeenCalledOnce();
    release(scheduled(at - 200));
    await Promise.all([first, second]);
    expect(storage.setAlarm).toHaveBeenLastCalledWith(at * 1000);
  });
  it("persists a check-in deadline and handles it without invoking the faction monitor", async () => {
    const { env, values, storage, alarm } = object();
    const at = Math.floor(Date.now() / 1000) + 30;
    await alarm.scheduleCheckIn("check-in", at);
    expect(values.get("checkInId")).toBe("check-in");
    expect(storage.setAlarm).toHaveBeenCalledWith(at * 1000);
    // Recreate the instance to model eviction before the deadline.
    await new ChainWatchAlarm({ storage } as unknown as DurableObjectState, env).alarm();
    expect(handleWatchCheckInAlarm).toHaveBeenCalledExactlyOnceWith(env, "check-in");
    expect(handleChainWatchAlarm).not.toHaveBeenCalled();
    expect(values.has("checkInId")).toBe(false);
  });
  it("reschedules a check-in alarm when delivery needs another attempt", async () => {
    const { values, storage, alarm } = object();
    const next = Math.floor(Date.now() / 1000) + 5;
    values.set("checkInId", "check-in");
    vi.mocked(handleWatchCheckInAlarm).mockResolvedValueOnce(next);
    await alarm.alarm();
    expect(storage.setAlarm).toHaveBeenCalledWith(next * 1000);
    expect(values.get("checkInId")).toBe("check-in");
  });
  it("propagates failures for durable alarm retry without forgetting the check-in", async () => {
    const { values, alarm } = object();
    values.set("checkInId", "check-in");
    vi.mocked(handleWatchCheckInAlarm).mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(alarm.alarm()).rejects.toThrow("Discord unavailable");
    expect(values.get("checkInId")).toBe("check-in");
  });
});
