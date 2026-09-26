import { getJson, postJson } from "./client";
import type { ArmoryResponse } from "../../../shared/armory";
export type { ArmoryCopy, ArmoryDetails, ArmoryResponse } from "../../../shared/armory";
export const getArmory = () => getJson<ArmoryResponse>("/api/admin/armory");
export const syncArmory = () => postJson<ArmoryResponse>("/api/admin/armory/sync");
export const refreshArmoryDetails = () => postJson<ArmoryResponse>("/api/admin/armory/details/refresh");
