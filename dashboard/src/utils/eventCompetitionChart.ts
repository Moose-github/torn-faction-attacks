import type { EventCompetition } from "../api/competition";

/** Keep one measured total per collection window, anchored to the event start. */
export function eventCompetitionChartData(
  data: Pick<EventCompetition, "history" | "chain_history" | "refresh_hours">,
  start: number,
  finish: number | null = null,
) {
  const collections = new Map<number | "final", EventCompetition["history"][number]>();
  for (const point of data.history) {
    // Final readings can arrive before the next regular collection is due.
    const window = finish !== null && point.observed_at >= finish
      ? "final" : Math.floor((point.observed_at - start) / (data.refresh_hours * 3600));
    const previous = collections.get(window);
    if (!previous || point.treats_gained > previous.treats_gained
      || (point.treats_gained === previous.treats_gained && point.observed_at > previous.observed_at)) {
      collections.set(window, point);
    }
  }
  const readings = [...collections.values()].sort((a, b) => a.observed_at - b.observed_at);
  const treats = new Map(readings.map(point => [point.observed_at, point.treats_gained]));
  // Fit a quadratic by least squares, using time scaled to [0, 1] for stability.
  // Orthogonalising x² against 1 and x also gives a linear fallback for two points.
  const origin = readings[0]?.observed_at ?? start;
  const end = readings[readings.length - 1]?.observed_at ?? origin;
  const x = (timestamp: number) => (timestamp - origin) / (end - origin || 1);
  const count = readings.length || 1;
  const meanX = readings.reduce((sum, point) => sum + x(point.observed_at), 0) / count;
  const meanY = readings.reduce((sum, point) => sum + point.treats_gained, 0) / count;
  const meanSquare = readings.reduce((sum, point) => sum + x(point.observed_at) ** 2, 0) / count;
  const variance = readings.reduce((sum, point) => sum + (x(point.observed_at) - meanX) ** 2, 0);
  const slope = variance > 0 ? readings.reduce((sum, point) =>
    sum + (x(point.observed_at) - meanX) * (point.treats_gained - meanY), 0) / variance : null;
  const projection = variance > 0 ? readings.reduce((sum, point) =>
    sum + (x(point.observed_at) - meanX) * x(point.observed_at) ** 2, 0) / variance : 0;
  const quadratic = (timestamp: number) => x(timestamp) ** 2 - meanSquare - projection * (x(timestamp) - meanX);
  const quadraticVariance = readings.reduce((sum, point) => sum + quadratic(point.observed_at) ** 2, 0);
  const curvature = readings.length >= 3 && quadraticVariance > 1e-12 ? readings.reduce((sum, point) =>
    sum + quadratic(point.observed_at) * (point.treats_gained - meanY), 0) / quadraticVariance : 0;
  // Sample the fitted curve independently of chain availability. These are estimates,
  // never additional collection dots or chain readings.
  const curveTimes = readings.length >= 3
    ? Array.from({ length: 121 }, (_, index) => origin + (end - origin) * index / 120) : [];
  const chain = new Map((data.chain_history ?? []).map(point => [point.observed_at, point.chain]));
  const times = [...new Set([...treats.keys(), ...chain.keys(), ...curveTimes])].sort((a, b) => a - b);
  let lastTreats: number | null = null;
  let treatsSampledAt: number | null = null;
  let lastChain: number | null = null;
  let chainSampledAt: number | null = null;
  return times.map(observed_at => {
    if (treats.has(observed_at)) {
      lastTreats = treats.get(observed_at)!;
      treatsSampledAt = observed_at;
    }
    if (chain.has(observed_at)) {
      lastChain = chain.get(observed_at)!;
      chainSampledAt = observed_at;
    }
    const trend = slope !== null && observed_at >= origin && observed_at <= end
      ? meanY + slope * (x(observed_at) - meanX) + curvature * quadratic(observed_at) : null;
    return {
      observed_at,
      treats_point: treats.get(observed_at) ?? null,
      treats_trend: trend,
      treats_gained: lastTreats,
      treats_sampled_at: treatsSampledAt,
      chain: lastChain,
      chain_sampled_at: chainSampledAt,
    };
  });
}

export type EventCompetitionChartPoint = ReturnType<typeof eventCompetitionChartData>[number];
