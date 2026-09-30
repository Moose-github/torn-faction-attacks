export interface PollContext {
  signal: AbortSignal;
  /** Also guards loaders that cannot cancel their underlying request. */
  isCurrent: () => boolean;
}

export interface PollOptions {
  intervalMs: number | null;
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  refreshOnFocus?: boolean;
  refreshOnVisible?: boolean;
  initialWhenHidden?: boolean;
  onError?: (error: unknown) => void;
}

export interface PollController {
  refresh: () => void;
  invalidate: () => void;
  stop: () => void;
}

/** A task may return its next delay, or false to stop automatic polling. */
export type PollTask = (context: PollContext) => Promise<void | number | false> | void | number | false;

/** Owns one request and one timer. Missed ticks are never replayed in a burst. */
export function startPolling(task: PollTask, options: PollOptions): PollController {
  let stopped = false;
  let running = false;
  let queued = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval = options.intervalMs;
  const hidden = () => typeof document !== "undefined" && document.hidden;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clearTimer();
    if (!stopped && interval !== null) timer = setTimeout(() => void run(), Math.max(1, interval));
  };

  async function run(initial = false) {
    if (stopped || running) return;
    if (options.pauseWhenHidden && hidden() && !(initial && options.initialWhenHidden !== false)) {
      schedule();
      return;
    }
    clearTimer();
    running = true;
    queued = false;
    const requestGeneration = generation;
    const request = new AbortController();
    controller = request;
    const isCurrent = () => !stopped && generation === requestGeneration && !request.signal.aborted;
    try {
      const next = await task({ signal: request.signal, isCurrent });
      if (isCurrent()) {
        if (next === false) interval = null;
        else if (typeof next === "number") interval = next;
      }
    } catch (error) {
      if (isCurrent()) options.onError?.(error);
    } finally {
      running = false;
      if (!stopped) {
        if (queued) void run();
        else schedule();
      }
    }
  }

  const refresh = () => { void run(); };
  const invalidate = () => {
    if (stopped) return;
    generation++;
    controller?.abort();
    // Unlike an ordinary refresh, a mutation requires a new response.
    if (running) queued = true;
    else void run();
  };
  const wake = () => { if (!hidden()) refresh(); };
  if (options.refreshOnFocus) window.addEventListener("focus", wake);
  if (options.refreshOnVisible) document.addEventListener("visibilitychange", wake);
  if (options.immediate !== false) void run(true);
  else schedule();

  return {
    refresh,
    invalidate,
    stop: () => {
      stopped = true;
      generation++;
      controller?.abort();
      clearTimer();
      if (options.refreshOnFocus) window.removeEventListener("focus", wake);
      if (options.refreshOnVisible) document.removeEventListener("visibilitychange", wake);
    },
  };
}
