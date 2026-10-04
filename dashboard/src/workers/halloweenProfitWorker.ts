import { compareHalloween, type HalloweenSettings } from "../utils/halloweenProfit";

// Averaging treat-drop and Revitalize simulations is CPU work; keep inputs responsive.
self.onmessage = (event: MessageEvent<HalloweenSettings>) => {
  try {
    self.postMessage({ results: compareHalloween(event.data), error: null });
  } catch (error) {
    self.postMessage({ results: [], error: error instanceof Error ? error.message : "Unable to calculate Halloween strategies." });
  }
};
