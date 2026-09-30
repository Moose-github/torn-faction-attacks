import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling, type PollController } from "./polling";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("polling lifecycle", () => {
  const polls: PollController[] = [];
  let page: EventTarget & { hidden: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    polls.splice(0).forEach(poll => poll.stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const start: typeof startPolling = (task, options) => {
    const poll = startPolling(task, options);
    polls.push(poll);
    return poll;
  };

  it("coalesces manual, focus and visibility refreshes while a slow request is active", async () => {
    const pending = deferred<void>();
    const load = vi.fn(() => pending.promise);
    const poll = start(load, { intervalMs: 100, refreshOnFocus: true, refreshOnVisible: true });
    poll.refresh();
    window.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates an old read and queues exactly one fresh read after it settles", async () => {
    const pending = deferred<void>();
    const accepted: number[] = [];
    const signals: AbortSignal[] = [];
    let calls = 0;
    const poll = start(async ({ signal, isCurrent }) => {
      const call = ++calls;
      signals.push(signal);
      if (call === 1) await pending.promise;
      if (isCurrent()) accepted.push(call);
    }, { intervalMs: 100 });
    poll.invalidate();
    poll.invalidate();
    expect(signals[0].aborted).toBe(true);
    expect(calls).toBe(1);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    expect(accepted).toEqual([2]);
  });

  it("pauses hidden pages and resumes on visibility without replaying missed ticks", async () => {
    const load = vi.fn(async () => {});
    start(load, { intervalMs: 100, pauseWhenHidden: true, refreshOnVisible: true });
    page.hidden = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers, listeners, and ignored-abort responses across remounts", async () => {
    const pending = deferred<void>();
    const accepted = vi.fn();
    const first = start(async ({ isCurrent }) => { await pending.promise; if (isCurrent()) accepted(); }, {
      intervalMs: 100, refreshOnFocus: true,
    });
    first.stop();
    const next = vi.fn(async () => {});
    start(next, { intervalMs: 100, refreshOnFocus: true });
    pending.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(accepted).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("supports server-directed delays, retries, and completed-resource polling stops", async () => {
    const load = vi.fn().mockResolvedValueOnce(200).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(false);
    const onError = vi.fn();
    start(load, { intervalMs: 100, onError });
    await vi.advanceTimersByTimeAsync(199);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(201);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("can defer the initial request and stop automatic polling after one load", async () => {
    const load = vi.fn(async () => false as const);
    const poll = start(load, { intervalMs: 100, immediate: false });
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).toHaveBeenCalledTimes(1);
    poll.refresh();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps inventory work idle when mounted hidden and silences cancellation errors", async () => {
    page.hidden = true;
    const load = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<void>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const onError = vi.fn();
    const poll = start(load, { intervalMs: 100, pauseWhenHidden: true, initialWhenHidden: false, refreshOnVisible: true, onError });
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(load).toHaveBeenCalledTimes(1);
    poll.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
