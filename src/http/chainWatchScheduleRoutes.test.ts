import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchDatabase } from "../../scripts/watch-test-database.mjs";
import { nextWatchHour, watchUtc } from "../../shared/chainWatchSchedule";
import { createWatch, readWatch } from "../chainWatchSchedule";
import { readAuthenticatedUserId, requireAdmin, requireMember } from "../auth";
import { routeWatchScheduleApi } from "./chainWatchScheduleRoutes";
import type { RouteContext } from "./context";

vi.mock("../auth", () => ({ requireAdmin: vi.fn(), requireMember: vi.fn(), readAuthenticatedUserId: vi.fn() }));
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
  id = (await createWatch(db.env, { name: "API test", guildId: "guild", channelId: "channel", discordUserId: "111" }, now)).id;
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.clearAllMocks(); });

function request(path: string, body?: unknown) {
  const req = new Request(`https://worker.test${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const context = { request: req, url: new URL(req.url), env: db.env, ctx: { waitUntil: vi.fn() } } as unknown as RouteContext;
  return routeWatchScheduleApi(context);
}

describe("chain watch page authorization", () => {
  it("requires sign-in to read the roster", async () => {
    vi.mocked(requireMember).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await request("/api/chain-watch"))?.status).toBe(401);
  });
  it("keeps all admin endpoints protected while Discord commands are public", async () => {
    expect((await request("/api/admin/chain-watch/slots", { watch_id: id, starts: [start], target_id: 2 }))?.status).toBe(403);
    expect((await request("/api/admin/chain-watch/finish", { watch_id: id, finish: watchUtc(start) }))?.status).toBe(403);
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
});
