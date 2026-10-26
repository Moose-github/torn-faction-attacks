import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchDatabase, watchThresholdEventsMigration } from "../../scripts/watch-test-database.mjs";
import { nextWatchHour, watchUtc, WATCH_DAY, WATCH_HOUR, type ChainWatchScheduleResponse } from "../../shared/chainWatchSchedule";
import { createWatch, readWatch } from "../chainWatchSchedule";
import { getChainWatchLive } from "../chainWatch";
import { syncWatchBoardsSafely } from "../chainWatchScheduleDiscord";
import { readAuthenticatedUserId, requireAdmin, requireMember } from "../auth";
import { routeWatchScheduleApi } from "./chainWatchScheduleRoutes";
import type { RouteContext } from "./context";

vi.mock("../auth", () => ({ requireAdmin: vi.fn(), requireMember: vi.fn(), readAuthenticatedUserId: vi.fn() }));
vi.mock("../chainWatch", () => ({ getChainWatchLive: vi.fn() }));
vi.mock("../chainWatchScheduleDiscord", () => ({ syncWatchBoardsSafely: vi.fn().mockResolvedValue(undefined) }));

const now = Date.UTC(2030, 0, 1, 12, 20) / 1000;
let db: ReturnType<typeof watchDatabase>;
let id: string;
const start = nextWatchHour(now);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
  vi.mocked(requireMember).mockResolvedValue(null);
  vi.mocked(requireAdmin).mockResolvedValue(new Response("Forbidden", { status: 403 }));
  vi.mocked(readAuthenticatedUserId).mockResolvedValue(1);
  db = watchDatabase(now);
  db.sqlite.exec(watchThresholdEventsMigration);
  id = (await createWatch(db.env, { name: "API test", guildId: "guild", channelId: "channel", discordUserId: "111" }, now)).id;
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function request(path: string, body?: unknown) {
  const req = new Request(`https://worker.test${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const background: Promise<unknown>[] = [];
  const context = { request: req, url: new URL(req.url), env: db.env,
    ctx: { waitUntil: (task: Promise<unknown>) => background.push(task) } } as unknown as RouteContext;
  const response = await routeWatchScheduleApi(context);
  await Promise.all(background);
  return response;
}

describe("chain watch page authorization", () => {
  it("requires membership to read live faction status", async () => {
    vi.mocked(requireMember).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await request("/api/chain-watch/live"))?.status).toBe(401);
    expect(getChainWatchLive).not.toHaveBeenCalled();
  });
  it("exposes the shared live status without a war or watch identifier", async () => {
    vi.mocked(getChainWatchLive).mockResolvedValue(Response.json({ ok: true, faction_id: 8803, state: null }));
    expect(await (await request("/api/chain-watch/live"))?.json()).toMatchObject({ faction_id: 8803 });
    expect(getChainWatchLive).toHaveBeenCalledExactlyOnceWith(db.env);
  });
  it("keeps the live endpoint read-only", async () => {
    expect((await request("/api/chain-watch/live", { enabled: true }))?.status).toBe(405);
    expect(getChainWatchLive).not.toHaveBeenCalled();
  });
  it("requires sign-in to read the roster", async () => {
    vi.mocked(requireMember).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await request("/api/chain-watch"))?.status).toBe(401);
  });
  it("keeps all admin endpoints protected while Discord commands are public", async () => {
    expect((await request("/api/admin/chain-watch/slots", { watch_id: id, starts: [start], target_id: 2 }))?.status).toBe(403);
    expect((await request("/api/admin/chain-watch/finish", { watch_id: id, finish: watchUtc(start) }))?.status).toBe(403);
    expect((await request("/api/admin/chain-watch/finish", { watch_id: id, finish: "ongoing" }))?.status).toBe(403);
    expect((await readWatch(db.env)).watch?.finish_at).toBeNull();
  });
  it("allows only a page admin to remove an unfinished watch's finish", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await request("/api/admin/chain-watch/finish", { watch_id: id, finish: watchUtc(start + 3600) }))?.status).toBe(200);
    expect((await readWatch(db.env)).watch?.finish_at).toBe(start + 3600);
    const response = await request("/api/admin/chain-watch/finish", { watch_id: id, finish: "ongoing" });
    expect(response?.status).toBe(200);
    expect((await readWatch(db.env)).watch?.finish_at).toBeNull();
  });
  it("ignores a member's forged admin flags and target identity", async () => {
    const response = await request("/api/chain-watch/slots", { watch_id: id, starts: [start], action: "claim", target_id: 2, admin: true });
    expect(response?.status).toBe(200);
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(1);
    vi.setSystemTime(start * 1000); db.setNow(start);
    expect((await request("/api/chain-watch/slots", { watch_id: id, starts: [start], action: "leave", admin: true }))?.status).toBe(409);
  });
  it("allows an authenticated page admin to replace a started slot", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    vi.setSystemTime(start * 1000); db.setNow(start);
    const response = await request("/api/admin/chain-watch/slots", { watch_id: id, starts: [start], target_id: 2 });
    expect(response?.status).toBe(200);
    expect((await readWatch(db.env)).slots[0].assigned_to).toBe(2);
  });

  it.each(["member", "admin"])("cleans up an unfilled-slot alert immediately after a %s fills it on the website", async actor => {
    const discord = await vi.importActual<typeof import("../chainWatchScheduleDiscord")>("../chainWatchScheduleDiscord");
    vi.mocked(syncWatchBoardsSafely).mockImplementationOnce(discord.syncWatchBoardsSafely);
    if (actor === "admin") vi.mocked(requireAdmin).mockResolvedValue(null);
    db.env.DISCORD_BOT_TOKEN = "fixture-token";
    db.sqlite.prepare(`UPDATE chain_watch_slots SET unfilled_alert_sent_at = ?,
      unfilled_alert_message_id = 'unfilled-message', unfilled_alert_channel_id = 'alert-thread'
      WHERE watch_id = ? AND start_at = ?`).run(now, id, start);
    const fetcher = vi.fn(async () => Response.json({ id: "published" }));
    vi.stubGlobal("fetch", fetcher);
    const response = await request(actor === "admin" ? "/api/admin/chain-watch/slots" : "/api/chain-watch/slots",
      { watch_id: id, starts: [start], action: "claim", target_id: 2 });
    expect(response?.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith("https://discord.com/api/v10/channels/alert-thread/messages/unfilled-message",
      expect.objectContaining({ method: "DELETE" }));
    expect(db.sqlite.prepare("SELECT unfilled_alert_deleted_at FROM chain_watch_slots WHERE watch_id = ? AND start_at = ?").get(id, start)?.unfilled_alert_deleted_at).toBe(now);
  });
});

describe("admin hourly threshold counts", () => {
  function event(reset: number, stage: "warning_60" | "warning_30", hour = start, watchId = id, assignedTo: number | null = 1) {
    db.sqlite.prepare(`INSERT INTO chain_watch_threshold_events
      (faction_id, reset_at, stage, timeout_at, chain_length, observed_at, watch_id, slot_start_at, assigned_to, assignment_revision)
      VALUES (8803, ?, ?, ?, 150, ?, ?, ?, ?, 1)`)
      .run(reset, stage, reset + 300, reset + (stage === "warning_60" ? 240 : 270), watchId, hour, assignedTo);
  }

  it("rejects non-admin reads of private counts", async () => {
    expect((await request(`/api/admin/chain-watch?watch=${id}`))?.status).toBe(403);
  });

  it("omits counts from member reads and writes, including forged admin flags", async () => {
    event(start, "warning_60");
    for (const url of ["/api/chain-watch", `/api/chain-watch?watch=${id}&admin=true`]) {
      const body = await (await request(url))!.json() as { slots: Record<string, unknown>[] };
      expect(body.slots.every(slot => !("threshold_counts" in slot))).toBe(true);
    }
    const body = await (await request("/api/chain-watch/slots", {
      watch_id: id, starts: [start], action: "claim", admin: true,
    }))!.json() as { slots: Record<string, unknown>[] };
    expect(body.slots.every(slot => !("threshold_counts" in slot))).toBe(true);
    expect((await readWatch(db.env)).slots.every(slot => slot.threshold_counts === undefined)).toBe(true);
  });

  it("counts warning and critical events per hour for only the selected watch", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    event(start, "warning_60"); event(start, "warning_30");
    event(start + 300, "warning_60", start, id, 2);
    event(start + WATCH_HOUR, "warning_30", start + WATCH_HOUR, id, null);
    event(start + 600, "warning_60", start, "another-watch");
    const body = await (await request(`/api/admin/chain-watch?watch=${id}`))!.json() as { slots: Array<{ threshold_counts: unknown }> };
    expect(body.slots.slice(0, 3).map(slot => slot.threshold_counts)).toEqual([
      { warning_60: 2, warning_30: 1 }, { warning_60: 0, warning_30: 1 }, { warning_60: 0, warning_30: 0 },
    ]);
  });

  it("retains hourly totals after reassignment and returns them in admin mutation responses", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    event(start, "warning_60");
    const body = await (await request("/api/admin/chain-watch/slots", {
      watch_id: id, starts: [start], target_id: 2,
    }))!.json() as ChainWatchScheduleResponse;
    expect(body.slots[0]).toMatchObject({ assigned_to: 2, threshold_counts: { warning_60: 1, warning_30: 0 } });
    expect(db.sqlite.prepare("SELECT assigned_to FROM chain_watch_threshold_events").get()?.assigned_to).toBe(1);
  });

  it("includes recorded counts on a finished watch", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    event(start, "warning_60");
    db.sqlite.prepare("UPDATE chain_watch_schedules SET is_open = 0, finish_at = ? WHERE id = ?").run(start + WATCH_HOUR, id);
    db.setNow(start + WATCH_HOUR); vi.setSystemTime((start + WATCH_HOUR) * 1000);
    const body = await (await request(`/api/admin/chain-watch?watch=${id}`))!.json() as ChainWatchScheduleResponse;
    expect(body.watch).toMatchObject({ id, is_open: 0 });
    expect(body.slots[0]).toMatchObject({ threshold_counts: { warning_60: 1, warning_30: 0 } });
  });
});

describe("chain watch history", () => {
  function pastWatch(watchId: string, daysAgo: number) {
    const pastStart = start - daysAgo * WATCH_DAY;
    db.sqlite.prepare(`INSERT INTO chain_watch_schedules
      (id, name, start_at, finish_at, guild_id, channel_id, is_open, created_by_discord_id)
      VALUES (?, ?, ?, ?, 'guild', 'old-channel', 0, '111')`).run(watchId, `Past ${watchId}`, pastStart, pastStart + WATCH_HOUR);
    db.sqlite.prepare(`INSERT INTO chain_watch_sheets (id, watch_id, start_at, end_at, discord_message_id)
      VALUES (?, ?, ?, ?, 'old-message')`).run(`${watchId}:sheet`, watchId, pastStart, pastStart + 2 * WATCH_HOUR);
    db.sqlite.prepare(`INSERT INTO chain_watch_slots (watch_id, sheet_id, start_at, assigned_to, cancelled)
      VALUES (?, ?, ?, 3, 0), (?, ?, ?, 2, 1)`)
      .run(watchId, `${watchId}:sheet`, pastStart, watchId, `${watchId}:sheet`, pastStart + WATCH_HOUR);
  }

  it("lists the current watch and all finished watches, newest first", async () => {
    pastWatch("older", 3);
    pastWatch("recent", 1);
    const response = await request("/api/chain-watch/history");
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ ok: true, now, watches: [
      { id, name: "API test", is_open: 1 },
      { id: "recent", name: "Past recent", is_open: 0 },
      { id: "older", name: "Past older", is_open: 0 },
    ] });
  });

  it("reads a selected past watch with retained assignments, cancelled slots and Discord links", async () => {
    pastWatch("older", 3);
    const response = await request("/api/chain-watch?watch=older");
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ watch: { id: "older", is_open: 0 },
      sheets: [{ id: "older:sheet", discord_message_id: "old-message" }],
      slots: [{ assigned_to: 3, member_name: "Former", cancelled: 0 }, { assigned_to: 2, member_name: "Bob", cancelled: 1 }],
    });
    expect((await readWatch(db.env)).watch?.id).toBe(id);
    expect((await request("/api/chain-watch?watch=missing"))?.status).toBe(404);
  });

  it("shows history even when there is no current watch", async () => {
    pastWatch("older", 3);
    db.sqlite.prepare("UPDATE chain_watch_schedules SET is_open = 0, finish_at = ? WHERE id = ?").run(start + WATCH_HOUR, id);
    db.setNow(start + WATCH_HOUR);
    vi.setSystemTime((start + WATCH_HOUR) * 1000);
    const response = await request("/api/chain-watch/history");
    expect(await response?.json()).toMatchObject({ watches: [{ id, is_open: 0 }, { id: "older", is_open: 0 }] });
  });

  it("returns an empty list before any watch has been created", async () => {
    db.sqlite.exec("DELETE FROM chain_watch_slots; DELETE FROM chain_watch_sheets; DELETE FROM chain_watch_schedules;");
    expect(await (await request("/api/chain-watch/history"))?.json()).toMatchObject({ ok: true, watches: [] });
  });

  it("requires membership for the history list and selected past roster", async () => {
    pastWatch("older", 3);
    vi.mocked(requireMember).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await request("/api/chain-watch/history"))?.status).toBe(401);
    expect((await request("/api/chain-watch?watch=older"))?.status).toBe(401);
    expect((await request("/api/admin/chain-watch/history"))?.status).toBe(403);
  });

  it("keeps history read-only and cannot claim an old assignment", async () => {
    pastWatch("older", 3);
    expect((await request("/api/chain-watch/history", { watch_id: id }))?.status).toBe(405);
    expect(readAuthenticatedUserId).not.toHaveBeenCalled();
    expect((await request("/api/chain-watch/slots", {
      watch_id: "older", starts: [start - 3 * WATCH_DAY], action: "claim",
    }))?.status).toBe(409);
    expect((await readWatch(db.env, "older")).slots[0].assigned_to).toBe(3);
  });
});
