import React from "react";
import { startPolling, type PollController, type PollOptions } from "../utils/polling";

interface Snapshot<T> {
  data: T | null;
  error: unknown;
  refreshing: boolean;
  updatedAt: number | null;
}

/** Local resource ownership; place this hook in a provider to share its result. */
export function usePollingResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  options: PollOptions & { enabled?: boolean },
) {
  const [snapshot, setSnapshot] = React.useState<Snapshot<T> & { key: string }>(() => ({
    key, data: null, error: null, refreshing: false, updatedAt: null,
  }));
  const loader = React.useRef(load);
  loader.current = load;
  const poller = React.useRef<PollController | null>(null);
  const revision = React.useRef(0);
  const activeKey = React.useRef(key);
  activeKey.current = key;
  const { intervalMs, immediate, pauseWhenHidden, refreshOnFocus, refreshOnVisible, initialWhenHidden, enabled = true } = options;
  React.useEffect(() => {
    setSnapshot(current => current.key === key ? current : { key, data: null, error: null, refreshing: false, updatedAt: null });
    if (!enabled) return;
    const poll = startPolling(async ({ signal, isCurrent }) => {
      const startedRevision = revision.current;
      const accept = () => isCurrent() && revision.current === startedRevision;
      setSnapshot(current => ({ ...current, refreshing: true }));
      try {
        const data = await loader.current(signal);
        if (accept()) setSnapshot({ key, data, error: null, refreshing: false, updatedAt: Date.now() });
      } catch (error) {
        if (accept()) setSnapshot(current => ({ ...current, error, refreshing: false }));
      }
    }, { intervalMs, immediate, pauseWhenHidden, refreshOnFocus, refreshOnVisible, initialWhenHidden });
    poller.current = poll;
    return () => { poll.stop(); poller.current = null; };
  }, [key, enabled, intervalMs, immediate, pauseWhenHidden, refreshOnFocus, refreshOnVisible, initialWhenHidden]);
  const refresh = React.useCallback(() => poller.current?.refresh(), []);
  const invalidate = React.useCallback(() => poller.current?.invalidate(), []);
  const setData = React.useCallback((value: React.SetStateAction<T | null>) => {
    if (activeKey.current !== key) return;
    revision.current++;
    setSnapshot(current => ({
      key, data: typeof value === "function" ? (value as (previous: T | null) => T | null)(current.key === key ? current.data : null) : value,
      error: null, refreshing: false, updatedAt: Date.now(),
    }));
  }, [key]);
  const current = enabled && snapshot.key === key ? snapshot : { data: null, error: null, refreshing: false, updatedAt: null };
  return { ...current, loading: enabled && current.data === null && current.error === null, refresh, invalidate, setData };
}
