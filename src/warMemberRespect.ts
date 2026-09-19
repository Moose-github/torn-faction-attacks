import { readAuthenticatedUserId, requireAdmin } from "./auth";
import type { Env } from "./types";
import { json } from "./utils";
import { readWarFromUrl } from "./warRequest";
import { refreshWarMemberRespect, WarStatsRebuildLeaseError } from "./warStats";

export async function recalculateWarMemberRespect(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const userId = await readAuthenticatedUserId(request, env);
    if (userId === null) {
      return json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401);
    }

    const memberIdText = url.pathname.split("/")[5] ?? "";
    const memberId = Number(memberIdText);
    if (!/^\d+$/.test(memberIdText) || !Number.isSafeInteger(memberId) || memberId <= 0) {
      return json({ ok: false, error: "Invalid member ID", code: "INVALID_MEMBER_ID" }, 400);
    }

    if (memberId !== userId) {
      const authError = await requireAdmin(request, env);
      if (authError) return authError;
    }

    const war = await readWarFromUrl(url, env);
    if (war instanceof Response) return war;

    const refresh = await refreshWarMemberRespect(env, war, memberId);
    if (refresh.status === "cooldown") {
      return json({
        ok: false,
        error: `Please wait ${refresh.retry_after_seconds} seconds before trying again`,
        code: "COOLDOWN_ACTIVE",
        retry_after_seconds: refresh.retry_after_seconds,
      }, 429);
    }

    const member = refresh.member;
    if (!member) {
      return json({ ok: false, error: "No recorded stats for this member in this war", code: "WAR_MEMBER_NOT_FOUND" }, 404);
    }

    return json({
      ok: true,
      war,
      member: {
        ...member,
        member_respect_limit_percent: war.member_respect_limit !== null && war.member_respect_limit > 0
          ? Number(member.respect_gained) * 100 / war.member_respect_limit
          : null,
      },
      recalculated_at: refresh.recalculated_at,
    });
  } catch (err) {
    if (err instanceof WarStatsRebuildLeaseError) {
      return json({ ok: false, error: err.message, code: err.code }, 409);
    }
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), code: "INTERNAL_ERROR" }, 500);
  }
}
