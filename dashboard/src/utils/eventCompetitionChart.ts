import type { EventCompetition } from "../api/competition";

/** Merge independent sampling times without inventing a chain value across a gap. */
export function eventCompetitionChartData(data: Pick<EventCompetition, "history" | "chain_history">) {
  const treats = new Map(data.history.map(point => [point.observed_at, point.treats_gained]));
  const chain = new Map((data.chain_history ?? []).map(point => [point.observed_at, point.chain]));
  const times = [...new Set([...treats.keys(), ...chain.keys()])].sort((a, b) => a - b);
  let lastTreats: number | null = null;
  let lastChain: number | null = null;
  let chainSampledAt: number | null = null;
  return times.map(observed_at => {
    if (treats.has(observed_at)) lastTreats = treats.get(observed_at)!;
    if (chain.has(observed_at)) {
      lastChain = chain.get(observed_at)!;
      chainSampledAt = observed_at;
    }
    return { observed_at, treats_gained: lastTreats, chain: lastChain, chain_sampled_at: chainSampledAt };
  });
}
