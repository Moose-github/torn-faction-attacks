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
  // Ordinary least squares, centred in hours to avoid squaring Unix timestamps.
  const origin = readings[0]?.observed_at ?? start;
  const hours = (timestamp: number) => (timestamp - origin) / 3600;
  const meanX = readings.reduce((sum, point) => sum + hours(point.observed_at), 0) / readings.length;
  const meanY = readings.reduce((sum, point) => sum + point.treats_gained, 0) / readings.length;
  const variance = readings.reduce((sum, point) => sum + (hours(point.observed_at) - meanX) ** 2, 0);
  const slope = variance > 0 ? readings.reduce((sum, point) =>
    sum + (hours(point.observed_at) - meanX) * (point.treats_gained - meanY), 0) / variance : null;
  const chain = new Map((data.chain_history ?? []).map(point => [point.observed_at, point.chain]));
  const times = [...new Set([...treats.keys(), ...chain.keys()])].sort((a, b) => a - b);
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
    const trend = slope !== null && observed_at >= origin && observed_at <= readings[readings.length - 1].observed_at
      ? meanY + slope * (hours(observed_at) - meanX) : null;
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
