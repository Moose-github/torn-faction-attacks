import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireMember } from "../auth";
import { fetchChainWatchTargets } from "../chainWatchTargets";
import { routeWatchScheduleApi } from "./chainWatchScheduleRoutes";
import { requireActionCooldown, type RouteContext } from "./context";

vi.mock("../auth", () => ({ requireMember: vi.fn(), requireAdmin: vi.fn(), readAuthenticatedUserId: vi.fn() }));
vi.mock("../chainWatchTargets", () => ({ fetchChainWatchTargets: vi.fn() }));
vi.mock("./context", async importOriginal => ({ ...await importOriginal<typeof import("./context")>(), requireActionCooldown: vi.fn() }));
const result = { target_ids: [123], status: "ok" as const, pages_fetched: 2, failed_pages: 0, checked_at: 12345 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMember).mockResolvedValue(null);
  vi.mocked(requireActionCooldown).mockResolvedValue(null);
  vi.mocked(fetchChainWatchTargets).mockResolvedValue(result);
});
function request(method = "POST") {
  const req = new Request("https://worker.test/api/chain-watch/targets", { method });
  return routeWatchScheduleApi({ request: req, url: new URL(req.url), env: {}, ctx: {} } as RouteContext);
}
describe("target fetch endpoint", () => {
  it("requires membership before fetching or consuming the cooldown", async () => {
    vi.mocked(requireMember).mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    expect((await request())?.status).toBe(401);
    expect(fetchChainWatchTargets).not.toHaveBeenCalled();
    expect(requireActionCooldown).not.toHaveBeenCalled();
  });
  it("only starts searches on POST", async () => {
    expect((await request("GET"))?.status).toBe(405);
    expect(fetchChainWatchTargets).not.toHaveBeenCalled();
  });
  it("returns IDs with no caching and uses the shared cooldown", async () => {
    const response = await request();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(await response?.json()).toEqual({ ok: true, ...result });
    expect(requireActionCooldown).toHaveBeenCalledWith({}, "chain_watch_target_search", 20);
  });
  it("does not call Torn during the cooldown", async () => {
    vi.mocked(requireActionCooldown).mockResolvedValue(new Response("Wait", { status: 429 }));
    expect((await request())?.status).toBe(429);
    expect(fetchChainWatchTargets).not.toHaveBeenCalled();
  });
  it.each([["no_targets", 200], ["unavailable", 503], ["timeout", 504]] as const)("maps %s to HTTP %s", async (status, code) => {
    vi.mocked(fetchChainWatchTargets).mockResolvedValue({ ...result, target_ids: [], status });
    expect((await request())?.status).toBe(code);
  });
});
