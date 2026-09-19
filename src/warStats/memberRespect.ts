import { bumpWarCacheVersion } from "../cacheVersions";
import { readSyncTimestamp } from "../syncState";
import type { Env } from "../types";
import { d1Changes, nowSeconds } from "../utils";
import { recalculateWarMemberRespectFromRaw } from "./memberStats";

export const WAR_MEMBER_RESPECT_COOLDOWN_SECONDS = 30;

type MemberRespectRefresh =
  | { status: "cooldown"; retry_after_seconds: number }
  | { status: "refreshed"; member: Record<string, unknown> | null; recalculated_at: number };

/** Shared by authenticated HTTP and Discord callers. */
export async function refreshWarMemberRespect(
  env: Env,
  war: { id: number; name: string },
  memberId: number,
): Promise<MemberRespectRefresh> {
  const now = nowSeconds();
  const cooldownName = `war_member_respect_recalculate:${war.id}:${memberId}`;
  // Claim atomically so concurrent requests across both entry points share one limit.
  const claim = await env.DB.prepare(`
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      updated_at = CURRENT_TIMESTAMP
    WHERE COALESCE(sync_state.last_started, 0) <= ?
  `).bind(cooldownName, now, now - WAR_MEMBER_RESPECT_COOLDOWN_SECONDS).run();

  if (d1Changes(claim) === 0) {
    const lastStarted = await readSyncTimestamp(env, cooldownName);
    return {
      status: "cooldown",
      retry_after_seconds: Math.max(1, WAR_MEMBER_RESPECT_COOLDOWN_SECONDS - (now - lastStarted)),
    };
  }

  const member = await recalculateWarMemberRespectFromRaw(env, war.id, memberId);
  if (member) await bumpWarCacheVersion(env, war.name);
  return { status: "refreshed", member, recalculated_at: nowSeconds() };
}
