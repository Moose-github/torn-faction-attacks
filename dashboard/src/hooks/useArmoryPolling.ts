import React from "react";
import { startPolling, type PollController } from "../utils/polling";

interface InventoryTiming {
  next_sync_at: number;
  next_inventory_at: number;
  error?: string | null;
}

/** Inventory reads may request a sync only when the server says it is due. */
export function useArmoryPolling<T extends InventoryTiming>(key: string, options: {
  load: (signal: AbortSignal) => Promise<T>;
  sync: () => Promise<T>;
  preserveEdits: (incoming: T, current: T) => T;
  errorMessage: string;
}) {
  const [data, setData] = React.useState<T | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const latest = React.useRef(options);
  latest.current = options;
  const revision = React.useRef(0);
  const working = React.useRef(false);
  const action = React.useRef<"check" | "inventory">("check");
  const poller = React.useRef<PollController | null>(null);
  React.useEffect(() => {
    setData(null);
    setError(null);
    setNotice("");
    const poll = startPolling(async ({ signal, isCurrent }) => {
      const manual = action.current === "inventory";
      action.current = "check";
      working.current = true;
      setBusy(true);
      const startedRevision = revision.current;
      const { load, sync, preserveEdits, errorMessage } = latest.current;
      const accept = (result: T) => setData(current => current && startedRevision !== revision.current
        ? preserveEdits(result, current) : result);
      try {
        let result = await load(signal);
        if (!isCurrent()) return;
        accept(result);
        if (manual && result.next_inventory_at * 1000 > Date.now()) {
          const next = new Date(result.next_inventory_at * 1000).toISOString().replace("T", " ").slice(0, 19) + " TCT";
          setNotice(`${result.error ? "The last refresh failed. Next retry" : "Inventory is cached. Next check"}: ${next}.`);
        }
        if (result.next_sync_at * 1000 <= Date.now() && !document.hidden) {
          result = await sync();
          if (!isCurrent()) return;
          accept(result);
          if (!result.error) setNotice("");
        }
        if (!manual && !result.error) setNotice("");
        setError(null);
        return Math.max(1000, Math.min(30_000, result.next_sync_at * 1000 - Date.now()));
      } catch (cause) {
        if (isCurrent()) setError(cause instanceof Error ? cause.message : errorMessage);
        return 60_000;
      } finally {
        if (isCurrent()) { working.current = false; setBusy(false); }
      }
    }, { intervalMs: 30_000, pauseWhenHidden: true, initialWhenHidden: false, refreshOnFocus: true, refreshOnVisible: true });
    poller.current = poll;
    return () => { poll.stop(); poller.current = null; working.current = false; };
  }, [key]);
  const refresh = React.useCallback((requested: "check" | "inventory" = "inventory") => {
    if (working.current || document.hidden) return;
    action.current = requested;
    poller.current?.refresh();
  }, []);
  const updateLocal = React.useCallback((update: (previous: T) => T) => {
    revision.current++;
    setData(current => current ? update(current) : current);
  }, []);
  return { data, busy, error, notice, refresh, updateLocal };
}
