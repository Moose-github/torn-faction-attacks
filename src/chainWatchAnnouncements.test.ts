import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchAlertDatabase } from "../scripts/watch-alert-test-database.mjs";
import { watchAnnouncementsMigration, watchSummaryRevisionsMigration } from "../scripts/watch-test-database.mjs";
import { WATCH_HOUR, watchUtc, type ChainWatchScheduleResponse } from "../shared/chainWatchSchedule";
import { createWatch, changeWatchSlots, readWatch, reconcileWatch, setWatchFinish } from "./chainWatchSchedule";
import { ensureWatchInfo, publishFinishedWatchSummaries, watchSummaryPayloads } from "./chainWatchAnnouncements";
import { runWatchScheduleCron, syncWatchBoards } from "./chainWatchScheduleDiscord";

const now = Date.UTC(2030, 0, 1, 12) / 1000;
const start = now + WATCH_HOUR;
const options = { name: "Test watch", start: watchUtc(start), finish: watchUtc(start + 4 * WATCH_HOUR), guildId: "guild", channelId: "sheet-thread", discordUserId: "111" };
let db: ReturnType<typeof watchAlertDatabase>;
const fetcher = vi.fn();
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const posts = () => fetcher.mock.calls.filter(call => call[1].method === "POST");
function advance(time: number) { db.setNow(time); vi.setSystemTime(time * 1000); }
function state(kind: string) { return db.sqlite.prepare("SELECT * FROM chain_watch_announcements WHERE kind = ?").get(kind); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = watchAlertDatabase(now);
  advance(now);
  db.env.DISCORD_BOT_TOKEN = "test-token";
  db.sqlite.exec("UPDATE discord_member_links SET discord_user_id = discord_user_id || discord_user_id");
  fetcher.mockReset().mockImplementation(async () => Response.json({ id: `message-${fetcher.mock.calls.length}` }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("chain watch Discord announcements", () => {
  it("posts the supplied rules once before every daily sheet", async () => {
    await createWatch(db.env, { ...options, finish: watchUtc(start + 25 * WATCH_HOUR) });
    await syncWatchBoards(db.env, now);
    expect(posts()).toHaveLength(3);
    const info = body(posts()[0]);
    expect(info.embeds[0].title).toBe("Test watch");
    expect(info.components).toEqual([]);
    for (const text of ["Maximum **2 shifts", "$10,000,000 per shift watched", "energy", "abroad", "bounties", "1–2 minutes", "full 5 minutes"]) expect(info.embeds[0].description).toContain(text);
    expect(posts().every(call => call[0] === "https://discord.com/api/v10/channels/sheet-thread/messages")).toBe(true);
    expect(info.allowed_mentions).toEqual({ parse: [], users: [], roles: [] });
    expect(body(posts()[1]).embeds[0].description).toContain("filled");
    await syncWatchBoards(db.env, now);
    expect(posts()).toHaveLength(3);
    expect(state("intro")?.sent_at).toBe(now);
  });

  it("blocks sheets and reminders until a failed info message is retried", async () => {
    const watch = await createWatch(db.env, options);
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 1, admin: true });
    fetcher.mockResolvedValueOnce(Response.json({ message: "Unavailable" }, { status: 503 }));
    advance(start - 180);
    await expect(runWatchScheduleCron(db.env)).rejects.toThrow("503");
    expect(posts()).toHaveLength(1);
    expect((await readWatch(db.env)).sheets[0].discord_message_id).toBeNull();
    const nonce = body(posts()[0]).nonce;
    await runWatchScheduleCron(db.env);
    expect(body(posts()[1]).nonce).toBe(nonce);
    expect(body(posts()[1]).enforce_nonce).toBe(true);
    expect(body(posts()[2]).embeds[0].description).toContain("filled");
    expect(posts().some(call => body(call).embeds?.[0]?.title === "Chain watch check-in")).toBe(true);
  });

  it("serializes concurrent info delivery and never lets a roster pass it", async () => {
    await createWatch(db.env, options);
    const data = await readWatch(db.env);
    let release!: () => void;
    let started!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    fetcher.mockImplementationOnce(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return Response.json({ id: "info" }); });
    const first = ensureWatchInfo(db.env, data);
    await sending;
    expect(await ensureWatchInfo(db.env, data)).toBe(false);
    await syncWatchBoards(db.env);
    expect(posts()).toHaveLength(1);
    release();
    expect(await first).toBe(true);
    await syncWatchBoards(db.env);
    expect(posts()).toHaveLength(2);
  });

  it("posts the same member totals once at finish, preserving cancelled history", async () => {
    const watch = await createWatch(db.env, options);
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start, start + WATCH_HOUR], actorId: 1, targetId: 1, admin: true });
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start + 2 * WATCH_HOUR, start + 3 * WATCH_HOUR], actorId: 1, targetId: 2, admin: true });
    await setWatchFinish(db.env, watch.id, watchUtc(start + 3 * WATCH_HOUR));
    await syncWatchBoards(db.env);
    advance(start + 3 * WATCH_HOUR - 1);
    await publishFinishedWatchSummaries(db.env);
    expect(state("summary")?.sent_at).toBeNull();
    advance(start + 3 * WATCH_HOUR);
    await runWatchScheduleCron(db.env);
    const summaries = posts().filter(call => body(call).embeds?.[0]?.title?.includes("Watch summary"));
    expect(summaries).toHaveLength(1);
    const payload = body(summaries[0]);
    expect(payload.embeds[0].description).toContain("**Alice**\nShifts: 2 · Payment: $20,000,000");
    expect(payload.embeds[0].description).toContain("**Bob**\nShifts: 1 · Payment: $10,000,000");
    expect(JSON.stringify(payload)).not.toMatch(/Watcher ID|Add Money|addMoneyTo/);
    expect(payload.components[0].components[0].label).toBe("Open page");
    expect(payload.allowed_mentions.parse).toEqual([]);
    const count = posts().length;
    await runWatchScheduleCron(db.env);
    expect(posts()).toHaveLength(count);
  });

  it("does not summarize a watch whose finish is extended or removed", async () => {
    const watch = await createWatch(db.env, options);
    await setWatchFinish(db.env, watch.id, "ongoing");
    advance(start + 5 * WATCH_HOUR);
    await publishFinishedWatchSummaries(db.env);
    expect(posts()).toHaveLength(0);
    expect(state("summary")?.sent_at).toBeNull();
  });

  it("sends an empty summary for a finished watch without assignments", async () => {
    await createWatch(db.env, options);
    advance(start + 4 * WATCH_HOUR);
    await publishFinishedWatchSummaries(db.env);
    expect(body(posts().at(-1)!).embeds[0].description).toContain("No completed watches were assigned.");
  });

  it("splits large summaries without admin actions or mentions", async () => {
    await createWatch(db.env, options);
    const data = await readWatch(db.env);
    data.now = start + 100 * WATCH_HOUR;
    data.slots = Array.from({ length: 100 }, (_, i) => ({ ...data.slots[0], start_at: start + i * WATCH_HOUR, assigned_to: i + 1, member_name: `Name_${i} @everyone` }));
    const pages = watchSummaryPayloads(db.env, data);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(page => page.embeds[0].description.length <= 4096)).toBe(true);
    expect(pages.map(page => page.embeds[0].description).join("\n").match(/Shifts:/g)).toHaveLength(100);
    expect(JSON.stringify(pages)).not.toContain("@everyone");
    expect(pages.every(page => page.embeds[0].footer?.text.includes(`of ${pages.length}`))).toBe(true);
  });

  it("resumes a partial summary from its stored pages without reposting success", async () => {
    await createWatch(db.env, options);
    await ensureWatchInfo(db.env, await readWatch(db.env));
    advance(start + 4 * WATCH_HOUR);
    const data: ChainWatchScheduleResponse = await readWatch(db.env);
    const page = watchSummaryPayloads(db.env, data)[0];
    db.sqlite.prepare("UPDATE chain_watch_announcements SET payloads_json = ?, payload_revision = revision WHERE kind = 'summary'").run(JSON.stringify([page, page]));
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json({ id: "page-1" })).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(publishFinishedWatchSummaries(db.env)).rejects.toThrow("503");
    expect(JSON.parse(String(state("summary")?.message_ids_json))).toEqual(["page-1"]);
    const failedNonce = body(posts()[1]).nonce;
    await publishFinishedWatchSummaries(db.env);
    expect(posts()).toHaveLength(3);
    expect(body(posts()[2]).nonce).toBe(failedNonce);
    expect(state("summary")?.sent_at).not.toBeNull();
    await publishFinishedWatchSummaries(db.env);
    expect(posts()).toHaveLength(3);
  });

  it("migrates existing watches without backfilling introductions or old summaries", async () => {
    const old = await createWatch(db.env, options);
    advance(start + 4 * WATCH_HOUR);
    await reconcileWatch(db.env);
    const current = await createWatch(db.env, { ...options, start: watchUtc(start + 5 * WATCH_HOUR), finish: undefined });
    db.sqlite.exec("DROP TRIGGER chain_watch_summary_assignment_changed; DROP TRIGGER chain_watch_summary_schedule_changed; DROP TRIGGER chain_watch_queue_announcements; DROP TABLE chain_watch_announcements;");
    db.sqlite.exec(watchAnnouncementsMigration);
    db.sqlite.exec(watchSummaryRevisionsMigration);
    const { results: rows } = await db.env.DB.prepare("SELECT watch_id, kind, sent_at FROM chain_watch_announcements")
      .all<{ watch_id: string; kind: string; sent_at: number | null }>();
    expect(rows.filter(row => row.watch_id === old.id).every(row => row.sent_at !== null)).toBe(true);
    expect(rows.find(row => row.watch_id === current.id && row.kind === "intro")?.sent_at).not.toBeNull();
    expect(rows.find(row => row.watch_id === current.id && row.kind === "summary")?.sent_at).toBeNull();
    await publishFinishedWatchSummaries(db.env);
    expect(posts()).toHaveLength(0);
  });
});

describe("corrected chain watch summaries", () => {
  async function finishedWatch(hours = 4) {
    const watch = await createWatch(db.env, { ...options, finish: watchUtc(start + hours * WATCH_HOUR) });
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 1, admin: true });
    await ensureWatchInfo(db.env, await readWatch(db.env));
    advance(start + hours * WATCH_HOUR);
    return watch;
  }
  const summaryIds = (): string[] => JSON.parse(String(state("summary")!.message_ids_json));
  const corrected = () => expect(state("summary")!.published_revision).toBe(state("summary")!.revision);

  it("edits the posted summary to match dashboard totals after a historical correction", async () => {
    const watch = await finishedWatch();
    await publishFinishedWatchSummaries(db.env);
    const ids = summaryIds();
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
    expect(Number(state("summary")!.revision)).toBeGreaterThan(Number(state("summary")!.published_revision));
    fetcher.mockClear();
    // This is the same sync entry point queued immediately by the admin route.
    await syncWatchBoards(db.env);
    const edits = fetcher.mock.calls.filter(call => String(call[0]).endsWith(`/messages/${ids[0]}`));
    expect(edits).toHaveLength(1);
    expect(edits[0][1].method).toBe("PATCH");
    expect(body(edits[0])).toEqual(watchSummaryPayloads(db.env, await readWatch(db.env, watch.id))[0]);
    expect(body(edits[0]).embeds[0].description).toContain("**Bob**");
    expect(body(edits[0]).embeds[0].description).not.toContain("Alice");
    expect(body(edits[0]).allowed_mentions.parse).toEqual([]);
    expect(summaryIds()).toEqual(ids);
    corrected();
  });

  it("retries a failed edit without marking the new totals published or duplicating the message", async () => {
    const watch = await finishedWatch();
    await publishFinishedWatchSummaries(db.env);
    const ids = summaryIds();
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(publishFinishedWatchSummaries(db.env)).rejects.toThrow("503");
    expect(Number(state("summary")!.published_revision)).toBeLessThan(Number(state("summary")!.revision));
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "PATCH"]);
    expect(summaryIds()).toEqual(ids);
    corrected();
  });

  it("retains an initial message ID when assignments change during its POST", async () => {
    const watch = await finishedWatch();
    fetcher.mockClear();
    fetcher.mockImplementationOnce(async () => {
      await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
      return Response.json({ id: "in-flight-summary" });
    });
    await publishFinishedWatchSummaries(db.env);
    expect(state("summary")!.sent_at).toBeNull();
    expect(summaryIds()).toEqual(["in-flight-summary"]);
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["POST", "PATCH"]);
    expect(body(fetcher.mock.calls[1]).embeds[0].description).toContain("**Bob**");
    corrected();
  });

  it("keeps a newer correction pending when it arrives during an older edit", async () => {
    const watch = await finishedWatch();
    await publishFinishedWatchSummaries(db.env);
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
    fetcher.mockClear();
    fetcher.mockImplementationOnce(async () => {
      await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: null, admin: true });
      return Response.json({});
    });
    await publishFinishedWatchSummaries(db.env);
    expect(Number(state("summary")!.published_revision)).toBeLessThan(Number(state("summary")!.revision));
    await publishFinishedWatchSummaries(db.env);
    expect(body(fetcher.mock.calls.at(-1)!).embeds[0].description).toContain("No completed watches were assigned.");
    corrected();
  });

  it("rejects a snapshot if assignments change while its totals are being read", async () => {
    const watch = await finishedWatch();
    const batch = db.env.DB.batch.bind(db.env.DB);
    let calls = 0;
    const reader = vi.spyOn(db.env.DB, "batch").mockImplementation(async statements => {
      const result = await batch(statements);
      if (++calls === 2) await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
      return result;
    });
    fetcher.mockClear();
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher).not.toHaveBeenCalled();
    expect(state("summary")!.published_revision).toBe(-1);
    reader.mockRestore();
    await publishFinishedWatchSummaries(db.env);
    expect(body(posts()[0]).embeds[0].description).toContain("**Bob**");
    corrected();
  });

  it("resumes growing and shrinking summaries after partial publication failures", async () => {
    const watch = await finishedWatch(40);
    await publishFinishedWatchSummaries(db.env);
    const firstId = summaryIds()[0];
    for (let i = 0; i < 40; i++) {
      db.sqlite.prepare("INSERT INTO home_faction_members VALUES (?, ?, 1)").run(100 + i, `Member ${i} ${"x".repeat(50)}`);
      db.sqlite.prepare("UPDATE chain_watch_slots SET assigned_to = ?, admin_override = 1 WHERE watch_id = ? AND start_at = ?")
        .run(100 + i, watch.id, start + i * WATCH_HOUR);
    }
    expect(watchSummaryPayloads(db.env, await readWatch(db.env, watch.id))).toHaveLength(2);
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(publishFinishedWatchSummaries(db.env)).rejects.toThrow("503");
    expect(state("summary")!.next_page).toBe(1);
    expect(summaryIds()).toEqual([firstId]);
    const failedNonce = body(posts()[0]).nonce;
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "POST", "POST"]);
    expect(body(posts()[1]).nonce).toBe(failedNonce);
    expect(summaryIds()).toHaveLength(2);
    corrected();
    const removedId = summaryIds()[1];
    db.sqlite.prepare("UPDATE chain_watch_slots SET assigned_to = 1, admin_override = 1 WHERE watch_id = ?").run(watch.id);
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(publishFinishedWatchSummaries(db.env)).rejects.toThrow("503");
    expect(summaryIds()).toHaveLength(2);
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "DELETE", "DELETE"]);
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain(removedId);
    expect(summaryIds()).toEqual([firstId]);
    corrected();
  });

  it("recreates a missing summary page when correcting it", async () => {
    const watch = await finishedWatch();
    await publishFinishedWatchSummaries(db.env);
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
    fetcher.mockClear();
    fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 })).mockResolvedValueOnce(Response.json({ id: "replacement-page" }));
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH", "POST"]);
    expect(summaryIds()).toEqual(["replacement-page"]);
    corrected();
  });

  it("avoids Discord edits when a correction is reversed before publication", async () => {
    const watch = await finishedWatch();
    await publishFinishedWatchSummaries(db.env);
    for (const targetId of [2, 1]) await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId, admin: true });
    fetcher.mockClear();
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher).not.toHaveBeenCalled();
    corrected();
  });

  it.each(["complete", "partial"])("reconciles %s summaries when migrating, including older corrections", async delivery => {
    const watch = await finishedWatch();
    const original = JSON.stringify(watchSummaryPayloads(db.env, await readWatch(db.env, watch.id)));
    db.sqlite.exec("DROP TRIGGER chain_watch_summary_assignment_changed; DROP TRIGGER chain_watch_summary_schedule_changed; DROP TRIGGER chain_watch_queue_announcements; DROP TABLE chain_watch_announcements;");
    db.sqlite.exec(watchAnnouncementsMigration);
    db.sqlite.prepare("UPDATE chain_watch_announcements SET sent_at = ?, payloads_json = ?, message_ids_json = ? WHERE kind = 'summary'")
      .run(delivery === "complete" ? start : null, original, JSON.stringify(["old-summary"]));
    await changeWatchSlots(db.env, { watchId: watch.id, starts: [start], actorId: 1, targetId: 2, admin: true });
    db.sqlite.exec(watchSummaryRevisionsMigration);
    fetcher.mockClear();
    await publishFinishedWatchSummaries(db.env);
    expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(["PATCH"]);
    expect(body(fetcher.mock.calls[0]).embeds[0].description).toContain("**Bob**");
    expect(summaryIds()).toEqual(["old-summary"]);
    corrected();
  });
});
