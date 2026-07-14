import { getJson, postJson } from "./client";
import type {
  RetaliationClaimResponse,
  RetaliationsResponse,
} from "./types";

export type RetaliationListOptions = {
  includeClaimed?: boolean;
  includeExpired?: boolean;
  limit?: number;
};

export function listAvailableRetaliations(options: RetaliationListOptions = {}): Promise<RetaliationsResponse> {
  const params = new URLSearchParams();
  if (options.includeClaimed) params.set("include_claimed", "true");
  if (options.includeExpired) params.set("include_expired", "true");
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return getJson<RetaliationsResponse>(`/api/retaliations/available${query ? `?${query}` : ""}`);
}

export function claimRetaliation(input: {
  target_id: number;
  opening_attack_id: number;
  attack_url?: string;
}): Promise<RetaliationClaimResponse> {
  return postJson<RetaliationClaimResponse>("/api/retaliations/claims", {
    ...input,
    source: "dashboard",
  });
}
