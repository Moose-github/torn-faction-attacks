import { LOL_MANAGER_BATTLESTATS_API_BASE_URL } from "../constants";
import { fetchExternalJson } from "./http";

export async function fetchBspBattlestatJson<T = unknown>(
  apiKey: string,
  memberId: number,
  timeoutMs: number,
): Promise<T> {
  const url = `${LOL_MANAGER_BATTLESTATS_API_BASE_URL}/${encodeURIComponent(apiKey)}/${memberId}/9.4.2`;
  return fetchExternalJson<T>("BSP battlestats", url, {
    headers: { Accept: "application/json" },
  }, { timeoutMs });
}
