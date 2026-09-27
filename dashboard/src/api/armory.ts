import { getJson, postJson } from "./client";
import type { ArmoryCategory, ArmoryResponse } from "../../../shared/armory";
export type { ArmoryCategory, ArmoryCopy, ArmoryDetails, ArmoryResponse } from "../../../shared/armory";
export const getArmory = (category: ArmoryCategory) => getJson<ArmoryResponse>(`/api/admin/armory?cat=${category}`);
export const syncArmory = (category: ArmoryCategory) => postJson<ArmoryResponse>(`/api/admin/armory/sync?cat=${category}`);
export const refreshArmoryDetails = (category: ArmoryCategory) => postJson<ArmoryResponse>(`/api/admin/armory/details/refresh?cat=${category}`);
