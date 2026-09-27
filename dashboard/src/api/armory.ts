import { getJson, postJson } from "./client";
import type { ArmoryCategory, ArmoryResponse, ArmoryMedicalResponse } from "../../../shared/armory";
export type { ArmoryCategory, ArmoryCopy, ArmoryDetails, ArmoryResponse } from "../../../shared/armory";
export const getArmory = (category: ArmoryCategory) => getJson<ArmoryResponse>(`/api/admin/armory?cat=${category}`);
export const syncArmory = (category: ArmoryCategory) => postJson<ArmoryResponse>(`/api/admin/armory/sync?cat=${category}`);
export const refreshArmoryDetails = (category: ArmoryCategory) => postJson<ArmoryResponse>(`/api/admin/armory/details/refresh?cat=${category}`);
export const getMedicalArmory = () => getJson<ArmoryMedicalResponse>("/api/admin/armory?cat=medical");
export const refreshArmoryActivity = () => postJson<{ ok: true; activity_fetched_at: number | null; status: "refreshed" | "cached" | "busy" }>("/api/admin/armory/activity/refresh");
export const syncMedicalArmory = () => postJson<ArmoryMedicalResponse>("/api/admin/armory/sync?cat=medical");
export const saveMedicalStockSetting = (id: number, threshold: number, enabled: boolean) =>
  postJson<ArmoryMedicalResponse>("/api/admin/armory/medical/stock", { id, threshold, enabled });
