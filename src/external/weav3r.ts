import { fetchExternalJson, throwIfUpstreamError } from "./http";

const WEAV3R_API_BASE = "https://api.weav3r.dev";
const WEAV3R_USER_AGENT = "buttgrass-trade-scout/1.0";

export async function fetchWeav3rJson<T = unknown>(endpoint: string, timeoutMs: number): Promise<T> {
  if (!endpoint.startsWith("/") || endpoint.includes("..") || endpoint.includes("//")) {
    throw new Error("Invalid Weav3r endpoint");
  }

  const data = await fetchExternalJson<T>("Weav3r", `${WEAV3R_API_BASE}${endpoint}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": WEAV3R_USER_AGENT,
    },
  }, { timeoutMs });
  throwIfUpstreamError(data, "Weav3r");
  return data;
}
