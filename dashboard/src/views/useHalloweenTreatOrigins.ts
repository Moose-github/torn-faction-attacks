import { useEffect, useMemo, useState } from "react";
import type { HalloweenResult, HalloweenSettings } from "../utils/halloweenProfit";
import type { HalloweenWorkerRequest, HalloweenWorkerResponse } from "../workers/halloweenProfitWorker";

type CachedTrace = { result: HalloweenResult | null; error: string | null };

/** Trace only the open panel's strategy. Closing cancels work, but retains completed traces. */
export function useHalloweenTreatOrigins(settings: HalloweenSettings, selected: HalloweenResult, enabled: boolean) {
  const { book, booster, simulationRuns: runs } = selected;
  const key = useMemo(() => JSON.stringify({ settings, book, booster, runs }), [settings, book, booster, runs]);
  const [cache, setCache] = useState(() => new Map<string, CachedTrace>());
  const cached = cache.get(key);
  useEffect(() => {
    if (!enabled || cached) return;
    let cancelled = false;
    let worker: Worker | undefined;
    const finish = (value: CachedTrace) => {
      if (cancelled) return;
      setCache(previous => {
        const next = new Map(previous);
        next.set(key, value);
        // Keep revisited strategies without retaining unlimited settings snapshots.
        if (next.size > 12) next.delete(next.keys().next().value!);
        return next;
      });
      worker?.terminate();
    };
    try {
      worker = new Worker(new URL("../workers/halloweenProfitWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<HalloweenWorkerResponse>) => {
        if (event.data.type !== "result") return;
        const result = event.data.results[0];
        if (event.data.error || !result?.treatOrigins) {
          finish({ result: null, error: event.data.error ?? "The simulation did not return its treat breakdown." });
        } else finish({ result, error: null });
      };
      worker.onerror = () => finish({ result: null, error: "Unable to trace this strategy. Please try again." });
      worker.postMessage({ settings, runs, strategy: { book, booster }, traceOrigins: true } satisfies HalloweenWorkerRequest);
    } catch {
      finish({ result: null, error: "Unable to start the simulation. Please try again." });
    }
    return () => { cancelled = true; worker?.terminate(); };
  }, [enabled, cached, key, settings, book, booster, runs]);

  return { result: cached?.result ?? null, error: cached?.error ?? null,
    retry: () => setCache(previous => { const next = new Map(previous); next.delete(key); return next; }) };
}
