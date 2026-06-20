import { upsertSyncTimestamp } from "./syncState";
import { Env } from "./types";
import { nowSeconds } from "./utils";

export const GLOBAL_WAR_CACHE_VERSION_NAME = "cache_version:war:all";
export const MEMBER_LIFESTYLE_CACHE_VERSION_NAME = "cache_version:member_lifestyle:v3";

export function warCacheVersionName(warName: string): string {
  return `cache_version:war:${warName.toLowerCase()}`;
}

export function warCacheVersionNames(warName: string): string[] {
  return [GLOBAL_WAR_CACHE_VERSION_NAME, warCacheVersionName(warName)];
}

export async function bumpWarCacheVersion(env: Env, warName: string): Promise<void> {
  await upsertSyncTimestamp(env, warCacheVersionName(warName), nowSeconds());
}

export async function bumpWarCacheVersionById(env: Env, warId: number): Promise<void> {
  const war = (await env.DB.prepare(
    `
    SELECT name
    FROM wars
    WHERE id = ?
    LIMIT 1
    `,
  )
    .bind(warId)
    .first()) as { name: string } | null;

  if (war) {
    await bumpWarCacheVersion(env, war.name);
  }
}

export async function bumpGlobalWarCacheVersion(env: Env): Promise<void> {
  await upsertSyncTimestamp(env, GLOBAL_WAR_CACHE_VERSION_NAME, nowSeconds());
}

export async function bumpMemberLifestyleCacheVersion(env: Env): Promise<void> {
  await upsertSyncTimestamp(env, MEMBER_LIFESTYLE_CACHE_VERSION_NAME, nowSeconds());
}
