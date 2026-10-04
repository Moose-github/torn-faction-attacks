import { compareHalloween, estimateHalloween, type HalloweenSettings, type HalloweenBook, type HalloweenResult } from "../utils/halloweenProfit";

export type HalloweenWorkerRequest = {
  settings: HalloweenSettings; runs: number; strategy?: { book: HalloweenBook; booster: string };
};
export type HalloweenWorkerResponse =
  | { type: "progress"; completed: number; total: number }
  | { type: "result"; results: HalloweenResult[]; error: string | null };

// Averaging treat-drop and Revitalize simulations is CPU work; keep inputs responsive.
self.onmessage = (event: MessageEvent<HalloweenWorkerRequest>) => {
  const { settings, runs, strategy } = event.data;
  const post = (message: HalloweenWorkerResponse) => self.postMessage(message);
  try {
    const results = strategy ? [estimateHalloween(settings, strategy.book, strategy.booster, runs)]
      : compareHalloween(settings, runs, (completed, total) => post({ type: "progress", completed, total }));
    post({ type: "result", results, error: null });
  } catch (error) {
    post({ type: "result", results: [], error: error instanceof Error ? error.message : "Unable to calculate Halloween strategies." });
  }
};
