import { FFSCOUTER_STATS_API_URL } from "../constants";
import { fetchExternalJson } from "./http";

export async function fetchFfscouterStatsJson<T = unknown>(
  apiKey: string,
  memberIds: number[],
  timeoutMs: number,
): Promise<T> {
  const url = new URL(FFSCOUTER_STATS_API_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("targets", memberIds.join(","));

  return fetchExternalJson<T>("FFScouter", url, {
    headers: { Accept: "application/json" },
  }, { timeoutMs });
}
