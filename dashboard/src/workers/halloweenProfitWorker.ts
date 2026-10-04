import { compareHalloween, type HalloweenSettings } from "../utils/halloweenProfit";

// Averaging Revitalize runs is CPU work; keep input controls responsive while it runs.
self.onmessage = (event: MessageEvent<HalloweenSettings>) => {
  try {
    self.postMessage({ results: compareHalloween(event.data), error: null });
  } catch (error) {
    self.postMessage({ results: [], error: error instanceof Error ? error.message : "Unable to calculate Halloween strategies." });
  }
};
