import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchDatabase } from "../scripts/watch-test-database.mjs";
import { confirmId, selectId, watchSessions } from "../scripts/watch-session-test-helpers";
import { changeWatchSlots, createWatch, readWatch } from "./chainWatchSchedule";
import { handleWatchInteraction } from "./chainWatchScheduleDiscord";
import type { DiscordInteractionResponse } from "./discordInteractions";

const now = Date.UTC(2030, 0, 1, 12, 20) / 1000;
const start = Date.UTC(2030, 0, 1, 13) / 1000;
let db: ReturnType<typeof watchDatabase>;
let sessions: ReturnType<typeof watchSessions>;
let watchId: string;
let sheetIds: string[];
let messageNumber: number;
let destinations: Map<string, string>;
let visible: Map<string, NonNullable<DiscordInteractionResponse["data"]>>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

function request(customId: string, values?: string[], user = "111", messageId = "private-111") {
  const result = sessions.interaction(customId, user, values, messageId);
  destinations.set(result.token!, messageId);
  return result;
}
async function deliver(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = String(input).split("/")[7];
  const messageId = destinations.get(token)!;
  if (init?.method === "DELETE") {
    visible.delete(messageId);
    return new Response(null, { status: 204 });
  }
  visible.set(messageId, JSON.parse(init!.body as string));
  return Response.json({ id: messageId });
}
async function open(action = "claim", sheet = sheetIds[0], user = "111") {
  const messageId = `private-${user}-${++messageNumber}`;
  const event = request(`cws:open:${action}:${sheet}`, undefined, user, messageId);
  // The source of an open interaction is the public roster, not its private reply.
  event.message = { id: `public-${sheet}` };
  const response = await sessions.handle(event);
  return { messageId, event, response, picker: selectId(response), user };
}
type Picker = Awaited<ReturnType<typeof open>>;
const pick = (picker: Picker, starts: number[]) => sessions.handle(request(picker.picker, starts.map(String), picker.user, picker.messageId));
const confirm = (picker: Picker, response: DiscordInteractionResponse) => sessions.handle(request(confirmId(response), undefined, picker.user, picker.messageId));
const pending = async () => (await db.env.DB.prepare("SELECT id, discord_user_id FROM chain_watch_pending_selections").all()).results;
const assignments = async () => (await readWatch(db.env, watchId)).slots.slice(0, 2).map(slot => slot.assigned_to);
const assign = (starts: number[], targetId: number | null = 1, actorId = 1) => changeWatchSlots(db.env, { watchId, starts, actorId, targetId, admin: false });
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now * 1000);
  db = watchDatabase(now);
  sessions = watchSessions(db.env);
  messageNumber = 0;
  destinations = new Map();
  visible = new Map();
  fetcher = vi.fn<typeof fetch>(deliver);
  vi.stubGlobal("fetch", fetcher);
  watchId = (await createWatch(db.env, { name: "Session tests", guildId: "guild", channelId: "channel", discordUserId: "111" }, now)).id;
  sheetIds = (await readWatch(db.env)).sheets.map(sheet => sheet.id);
});
afterEach(() => { db.sqlite.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["claim", "leave"])("only confirms the latest %s selection and never reopens a completed message", async action => {
  if (action === "leave") await assign([start, start + 3600]);
  const picker = await open(action);
  const a = await pick(picker, [start]);
  const b = await pick(picker, [start + 3600]);
  expect(await pending()).toEqual([{ id: confirmId(b).split(":")[3], discord_user_id: "111" }]);
  const stale = await confirm(picker, a);
  expect(confirmId(stale)).toBe(confirmId(b));
  expect(await assignments()).toEqual(action === "claim" ? [null, null] : [1, 1]);
  const saved = await confirm(picker, b);
  expect(saved.data?.content).toContain(action === "claim" ? "Signed up for 1 slot" : "Left 1 slot");
  expect(saved.data?.components).toEqual([]);
  expect(await assignments()).toEqual(action === "claim" ? [null, 1] : [1, null]);
  expect(await pending()).toEqual([]);
  await pick(picker, [start]);
  await confirm(picker, b);
  expect(visible.get(picker.messageId)).toEqual(saved.data);
  expect(await assignments()).toEqual(action === "claim" ? [null, 1] : [1, null]);
});

it("replaces the user's previous message across sheets and between claim and leave", async () => {
  const tomorrow = start + 11 * 3600;
  await assign([tomorrow]);
  const old = await open();
  const oldChoice = await pick(old, [start]);
  const replacement = await open("leave", sheetIds[1]);
  expect(visible.has(old.messageId)).toBe(false);
  expect(visible.has(replacement.messageId)).toBe(true);
  expect(fetcher.mock.calls.slice(-2).map(call => call[1]?.method)).toEqual(["DELETE", "PATCH"]);
  const current = await pick(replacement, [tomorrow]);
  await confirm(old, oldChoice);
  await pick(old, [start + 3600]);
  expect(await pending()).toEqual([{ id: confirmId(current).split(":")[3], discord_user_id: "111" }]);
  expect(await assignments()).toEqual([null, null]);
  expect(visible.has(old.messageId)).toBe(false);
  await confirm(replacement, current);
  expect((await readWatch(db.env)).slots.find(slot => slot.start_at === tomorrow)?.assigned_to).toBeNull();
});

it("keeps different users independent and binds each selection to its private message", async () => {
  const alice = await open();
  const a = await pick(alice, [start]);
  const bob = await open("claim", sheetIds[0], "222");
  const b = await pick(bob, [start + 3600]);
  await sessions.handle(request(confirmId(a), undefined, "222", bob.messageId));
  await sessions.handle(request(confirmId(a), undefined, "111", "another-private-message"));
  expect(await pending()).toHaveLength(2);
  expect(await assignments()).toEqual([null, null]);
  await confirm(alice, a);
  await confirm(bob, b);
  expect(await assignments()).toEqual([1, 2]);
});

it.each([["bad"], [], [String(start - 3600)], [start, start + 3600, start + 7200].map(String)].map(values => ({ values })))(
  "invalidates the previous confirmation even when the new selection $values is invalid", async ({ values }) => {
    const picker = await open();
    const a = await pick(picker, [start]);
    const invalid = await sessions.handle(request(picker.picker, values, "111", picker.messageId));
    expect(invalid.data?.components?.[1].components[0]).toMatchObject({ disabled: true });
    expect(await pending()).toEqual([]);
    await confirm(picker, a);
    expect(await assignments()).toEqual([null, null]);
    expect(visible.get(picker.messageId)?.components?.[1].components[0]).toMatchObject({ disabled: true });
  },
);

it("ignores older or duplicate selections delivered after a newer selection", async () => {
  const picker = await open();
  const older = request(picker.picker, [String(start)], "111", picker.messageId);
  const newer = request(picker.picker, [String(start + 3600)], "111", picker.messageId);
  const b = await sessions.handle(newer);
  const calls = fetcher.mock.calls.length;
  expect(await sessions.handle(older)).toBeUndefined();
  expect(await sessions.handle(newer)).toBeUndefined();
  // Redelivery of the original open must not delete its still-current message.
  expect(await sessions.handle(picker.event)).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(visible.has(picker.messageId)).toBe(true);
  await confirm(picker, b);
  expect(await assignments()).toEqual([null, 1]);
});

it("deletes an older open delivered out of order without replacing the newer message", async () => {
  const old = request(`cws:open:claim:${sheetIds[0]}`, undefined, "111", "old-open");
  const current = await open();
  const selected = await pick(current, [start]);
  await sessions.handle(old);
  expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  expect(visible.has(current.messageId)).toBe(true);
  await confirm(current, selected);
  expect(await assignments()).toEqual([1, null]);
});

it("orders slow PATCH responses before newer selections and confirmation", async () => {
  const picker = await open();
  const aRequest = request(picker.picker, [String(start)], "111", picker.messageId);
  const bRequest = request(picker.picker, [String(start + 3600)], "111", picker.messageId);
  const aStarted = gate(), releaseA = gate(), bStarted = gate(), releaseB = gate();
  let bPayload!: NonNullable<DiscordInteractionResponse["data"]>;
  fetcher.mockImplementation(async (url, init) => {
    if (String(url).includes(`/${aRequest.token}/`)) { aStarted.resolve(); await releaseA.promise; }
    if (String(url).includes(`/${bRequest.token}/`)) {
      bPayload = JSON.parse(init!.body as string); bStarted.resolve(); await releaseB.promise;
    }
    return deliver(url, init);
  });
  const a = sessions.handle(aRequest);
  await aStarted.promise;
  const b = sessions.handle(bRequest);
  await Promise.resolve();
  expect(fetcher.mock.calls.filter(call => String(call[0]).includes(`/${bRequest.token}/`))).toHaveLength(0);
  releaseA.resolve();
  await a;
  await bStarted.promise;
  const delayedBeforeConfirm = request(picker.picker, [String(start)], "111", picker.messageId);
  const saved = sessions.handle(request(confirmId({ type: 7, data: bPayload }), undefined, "111", picker.messageId));
  await Promise.resolve();
  expect(await assignments()).toEqual([null, null]);
  releaseB.resolve();
  await Promise.all([b, saved]);
  expect(visible.get(picker.messageId)?.components).toEqual([]);
  expect(await assignments()).toEqual([null, 1]);
  const calls = fetcher.mock.calls.length;
  await sessions.handle(delayedBeforeConfirm);
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(visible.get(picker.messageId)?.components).toEqual([]);
});

it("serializes simultaneous opens through old-message deletion", async () => {
  const firstRequest = request(`cws:open:claim:${sheetIds[0]}`, undefined, "111", "first");
  const nextRequest = request(`cws:open:claim:${sheetIds[1]}`, undefined, "111", "next");
  const started = gate(), release = gate();
  fetcher.mockImplementationOnce(async (url, init) => { started.resolve(); await release.promise; return deliver(url, init); });
  const first = sessions.handle(firstRequest);
  await started.promise;
  const next = sessions.handle(nextRequest);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release.resolve();
  await Promise.all([first, next]);
  expect(fetcher.mock.calls.map(call => call[1]?.method)).toEqual(["PATCH", "DELETE", "PATCH"]);
  expect([...visible.keys()]).toEqual(["next"]);
});

it("persists the latest selection and completed state across coordinator restarts", async () => {
  const picker = await open();
  const a = await pick(picker, [start]);
  sessions.restart();
  const b = await pick(picker, [start + 3600]);
  sessions.restart();
  await confirm(picker, a);
  expect(await assignments()).toEqual([null, null]);
  await confirm(picker, b);
  sessions.restart();
  await pick(picker, [start]);
  expect(visible.get(picker.messageId)?.components).toEqual([]);
  expect(await assignments()).toEqual([null, 1]);
});

it("fails closed after a restart with an interrupted message update", async () => {
  const picker = await open();
  const a = await pick(picker, [start]);
  const store = sessions.stores.get("111")!;
  const state = store.get("state") as { session: { publishing: boolean } };
  state.session.publishing = true; // Persisted just before a PATCH; no delivery acknowledgement.
  store.set("state", structuredClone(state));
  sessions.restart();
  await confirm(picker, a);
  expect(await assignments()).toEqual([null, null]);
  expect(await pending()).toEqual([]);
  expect(visible.get(picker.messageId)?.components).toEqual([]);
  expect(fetcher.mock.calls.slice(-2).map(call => call[1]?.method)).toEqual(["DELETE", "PATCH"]);
});

it("closes persistently before committing assignments, so a crash cannot replay a confirmation", async () => {
  const picker = await open();
  const choice = await pick(picker, [start]);
  const originalBatch = db.env.DB.batch.bind(db.env.DB);
  const batch = vi.spyOn(db.env.DB, "batch").mockImplementation(async statements => {
    const result = await originalBatch(statements);
    if ((await pending()).length === 0 && (await db.env.DB.prepare("SELECT assigned_to FROM chain_watch_slots WHERE start_at = ?").bind(start).first<{ assigned_to: number }>())?.assigned_to === 1) {
      const state = sessions.stores.get("111")!.get("state") as { session: { closed: boolean; response: DiscordInteractionResponse } };
      expect(state.session.closed).toBe(true);
      expect(state.session.response.data?.components).toEqual([]);
    }
    return result;
  });
  await confirm(picker, choice);
  batch.mockRestore();
  expect(await assignments()).toEqual([1, null]);
});

it.each(["claim", "leave"])("rechecks started slots when confirming %s", async action => {
  if (action === "leave") await assign([start]);
  db.setNow(start - 60); vi.setSystemTime((start - 60) * 1000);
  const picker = await open(action);
  const choice = await pick(picker, [start]);
  db.setNow(start); vi.setSystemTime(start * 1000);
  const response = await confirm(picker, choice);
  expect(response.data?.content).toContain("already started");
  expect(response.data?.components).toEqual([]);
  expect(await assignments()).toEqual(action === "claim" ? [null, null] : [1, null]);
});

it.each([404, 503])("invalidates the old message even when Discord deletion fails with %s", async status => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const old = await open();
  const oldChoice = await pick(old, [start]);
  fetcher.mockResolvedValueOnce(new Response("{}", { status }));
  const current = await open();
  const b = await pick(current, [start + 3600]);
  await confirm(old, oldChoice);
  expect(await assignments()).toEqual([null, null]);
  await confirm(current, b);
  expect(await assignments()).toEqual([null, 1]);
});

it("closes a selection after an uncertain PATCH failure and recovers on a new open", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const picker = await open();
  let uncertain!: DiscordInteractionResponse;
  fetcher.mockImplementationOnce(async (_url, init) => {
    uncertain = { type: 7, data: JSON.parse(init!.body as string) };
    throw new Error("Connection lost after sending");
  });
  await pick(picker, [start]);
  expect(await pending()).toEqual([]);
  sessions.restart();
  await confirm(picker, uncertain);
  expect(await assignments()).toEqual([null, null]);
  expect(visible.get(picker.messageId)?.components).toEqual([]);
  const replacement = await open();
  await confirm(replacement, await pick(replacement, [start + 3600]));
  expect(await assignments()).toEqual([null, 1]);
});

it("expires inactive messages, removes webhook credentials, and keeps newer sessions on an old alarm", async () => {
  const first = await open();
  const a = await pick(first, [start]);
  db.setNow(now + 590); vi.setSystemTime((now + 590) * 1000);
  const second = await open();
  const b = await pick(second, [start + 3600]);
  db.setNow(now + 601); vi.setSystemTime((now + 601) * 1000);
  await sessions.controller().expire();
  expect(visible.has(second.messageId)).toBe(true);
  db.setNow(now + 1191); vi.setSystemTime((now + 1191) * 1000);
  await sessions.controller().expire();
  expect(visible.has(second.messageId)).toBe(false);
  expect(await pending()).toEqual([]);
  expect(sessions.stores.get("111")!.get("state")).toEqual({ lastInteractionId: expect.any(String) });
  await confirm(first, a);
  await confirm(second, b);
  expect(await assignments()).toEqual([null, null]);
});

it("rejects legacy controls and component calls outside the session coordinator", async () => {
  const legacy = request(`cws:pick:claim:${sheetIds[0]}`, [String(start)]);
  expect((await sessions.handle(legacy)).data?.content).toContain("expired");
  expect((await handleWatchInteraction(legacy, db.env)).data?.content).toContain("expired");
  expect(await pending()).toEqual([]);
  expect(await assignments()).toEqual([null, null]);
});

it("consumes a confirmation atomically, and rolls back every slot on a conflict", async () => {
  const picker = await open();
  const response = await pick(picker, [start, start + 3600]);
  const selectionId = confirmId(response).split(":")[3];
  await assign([start + 3600], 2, 2);
  await expect(changeWatchSlots(db.env, { watchId, starts: [start, start + 3600], actorId: 1, targetId: 1, admin: false, selectionId })).rejects.toThrow("another player");
  expect(await assignments()).toEqual([null, 2]);
  expect(await pending()).toHaveLength(1);
  await assign([start + 3600], null, 2);
  await confirm(picker, response);
  expect(await assignments()).toEqual([1, 1]);
  expect(await pending()).toEqual([]);
  // If the player leaves later, replaying the consumed confirmation must not rejoin.
  await assign([start, start + 3600], null);
  await expect(changeWatchSlots(db.env, { watchId, starts: [start, start + 3600], actorId: 1, targetId: 1, admin: false, selectionId })).rejects.toThrow("already used");
  expect(await assignments()).toEqual([null, null]);
});
