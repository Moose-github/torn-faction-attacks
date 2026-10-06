import { calculateProgressionRecommendations, type ProgressionReport, type ProgressionUpdate } from "../utils/halloweenProgression";
import type { HalloweenSettings } from "../utils/halloweenProfit";
export type ProgressionRequest = { settings: HalloweenSettings; allowance: number; runs: number; previous?: ProgressionReport };
export type ProgressionResponse = { type: "progress"; progress: ProgressionUpdate }
  | { type: "result"; report: ProgressionReport } | { type: "error"; message: string };
self.onmessage = (event: MessageEvent<ProgressionRequest>) => {
  const { settings, allowance, runs, previous } = event.data;
  const post = (message: ProgressionResponse) => self.postMessage(message);
  try { post({ type: "result", report: calculateProgressionRecommendations(settings, allowance, runs,
    progress => post({ type: "progress", progress }), previous) }); }
  catch (error) { post({ type: "error", message: error instanceof Error ? error.message : "Unable to calculate recommendations." }); }
};
