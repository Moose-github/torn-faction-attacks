import { getJson } from "./client";
import type { AdminPacksResponse } from "./types";

export async function getAdminPacks(): Promise<AdminPacksResponse> {
  return getJson<AdminPacksResponse>("/api/admin/packs", true);
}
