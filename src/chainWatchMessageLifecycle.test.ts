import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chainWatchDatabase } from "../scripts/chain-watch-test-database.mjs";
import { handleChainWatchAlarm, readChainWatchState, runChainWatchCron } from "./chainWatch";
import { createWatch } from "./chainWatchSchedule";
import { watchUtc } from "../shared/chainWatchSchedule";
import { HOME_FACTION_ID } from "./constants";
import { fetchTrackedTornJson } from "./external/torn";

vi.mock("./external/torn", () => ({ fetchTrackedTornJson: vi.fn() }));
vi.mock("./tornKeyPool", () => ({ withTornKeyPool: (_env: unknown, options: { run: (key: unknown) => Promise<unknown> }) => options.run({ key: "test" }) }));
vi.mock("./discordAlertSettings", () => ({ isDiscordAlertEnabled: async () => true }));
vi.mock("./discordMentions", async original => ({
  ...await original<typeof import("./discordMentions")>(),
  readDiscordAlertMentions: async () => ({ messageSuffix: "<@123456>", allowedMentions: { users: ["123456"] } }),
}));
vi.mock("./discordNotificationChannels", () => ({
  readConfiguredDiscordNotificationChannel: async (_env: unknown, key: string) => ({ channelId: key }),
  discordNotificationChannelTargetId: (route: { channelId: string }) => route.channelId,
}));

const start = Date.UTC(2030, 0, 1, 13) / 1000;
let db: ReturnType<typeof chainWatchDatabase>;
const messages = new Map<string, Record<string, any>>();
let nextMessageId = 0;
const fetcher = vi.fn();
function advance(now: number) { db.setNow(now); vi.setSystemTime(now * 1000); }
async function tick(now: number) { advance(now); await runChainWatchCron(db.env, now * 1000); }
async function hit(id: number, at: number, chain: number) {
  await db.env.DB.prepare(`INSERT INTO attacks (id, started, ended, attacker_faction_id, defender_faction_id,
    attacker_name, defender_name, result, chain) VALUES (?, ?, ?, ?, 999, 'Alice', 'Bob', 'Hospitalized', ?)`)
    .bind(id, at, at, HOME_FACTION_ID, chain).run();
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = chainWatchDatabase(start - 60);
  advance(start - 60);
  db.env.DISCORD_BOT_TOKEN = "fixture-token";
  db.env.CHAIN_WATCH_ALARMS = { getByName: () => ({ syncFaction: async () => {} }) } as unknown as DurableObjectNamespace;
  messages.clear();
  nextMessageId = 0;
  vi.mocked(fetchTrackedTornJson).mockReset().mockResolvedValue({ chain: { current: 0, timeout: 0 } });
  fetcher.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === "DELETE") { messages.delete(url.split("/").at(-1)!); return new Response(null, { status: 204 }); }
    const patch = init.method === "PATCH";
    const id = patch ? url.split("/").at(-1)! : `message-${++nextMessageId}`;
    const body = JSON.parse(init.body as string);
    // PATCH retains omitted fields. Discord requires legacy fields to be cleared
    // when converting an existing message to Components V2; empty values are valid.
    const result = { ...(patch ? messages.get(id) : {}), ...body };
    if ((result.flags & 32768) && (result.content || result.embeds?.length)) {
      return Response.json({ message: "Invalid Form Body", code: 50035,
        errors: { content: { _errors: [{ code: "MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2" }] } } }, { status: 400 });
    }
    messages.set(id, result);
    return Response.json({ id });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("sends warning and critical cards, finalizes the plain status, then sends warnings for the next chain", async () => {
  await createWatch(db.env, { name: "Watch", start: watchUtc(start), guildId: "guild", channelId: "channel", discordUserId: "111" }, start - 60);
  await hit(1, start, 543);
  await tick(start);
  const statusId = (await readChainWatchState(db.env))!.discord_message_id!;
  expect(messages.get(statusId)?.content).toContain("chain 543 is active");
  for (const [offset, timeout] of [[240, 60], [270, 30]]) {
    advance(start + offset);
    vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 543, timeout } });
    await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
  }
  const cycle = await db.env.DB.prepare("SELECT * FROM chain_watch_warning_cycles").first();
  expect(cycle).toMatchObject({ warning_message_id: expect.any(String), critical_message_id: expect.any(String) });
  const warningPosts = fetcher.mock.calls.filter(([url, init]) => init.method === "POST" && /chain_watch_(warning|critical)\//.test(url));
  expect(warningPosts).toHaveLength(2);
  for (const [, init] of warningPosts) {
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("content");
    expect(body).not.toHaveProperty("embeds");
    expect(body).toMatchObject({ flags: 32768, allowed_mentions: { users: ["123456"] } });
  }
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 0, timeout: 0 } });
  await tick(start + 300);
  expect(await readChainWatchState(db.env)).toMatchObject({ discord_message_id: null, drop_sent_at: start + 300, last_error: null });
  expect(messages.get(statusId)).toMatchObject({ flags: 32768, content: null, embeds: [] });
  expect(messages.get(cycle!.critical_message_id as string)?.components).toEqual([{ type: 10, content: "Chain length 543 was dropped" }]);
  await hit(2, start + 310, 101);
  await tick(start + 310);
  expect((await readChainWatchState(db.env))!.discord_message_id).not.toBe(statusId);
  advance(start + 550);
  vi.mocked(fetchTrackedTornJson).mockResolvedValue({ chain: { current: 101, timeout: 60 } });
  await handleChainWatchAlarm(db.env, HOME_FACTION_ID);
  expect(await readChainWatchState(db.env)).toMatchObject({ current_chain: 101, warning_60_sent_at: start + 550, last_error: null });
  expect(fetcher.mock.calls.filter(([url, init]) => init.method === "POST" && url.includes("/chain_watch_warning/"))).toHaveLength(2);
});
