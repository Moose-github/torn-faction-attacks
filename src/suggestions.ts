import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

const MIN_SUGGESTION_LENGTH = 3;
const MAX_SUGGESTION_LENGTH = 1200;
const DEFAULT_ADMIN_SUGGESTION_LIMIT = 12;
const MAX_ADMIN_SUGGESTION_LIMIT = 50;

type MemberSuggestion = {
  id: number;
  torn_user_id: number;
  member_name: string | null;
  suggestion: string;
  created_at: number;
};

export async function createMemberSuggestion(
  request: Request,
  env: Env,
  tornUserId: number,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { suggestion?: unknown };
  const suggestion = typeof body.suggestion === "string" ? body.suggestion.trim() : "";

  if (suggestion.length < MIN_SUGGESTION_LENGTH) {
    return json(
      {
        ok: false,
        error: "Suggestion must be at least 3 characters.",
        code: "SUGGESTION_TOO_SHORT",
      },
      400,
    );
  }

  if (suggestion.length > MAX_SUGGESTION_LENGTH) {
    return json(
      {
        ok: false,
        error: `Suggestion must be ${MAX_SUGGESTION_LENGTH} characters or fewer.`,
        code: "SUGGESTION_TOO_LONG",
      },
      400,
    );
  }

  const now = nowSeconds();
  const userAgent = request.headers.get("User-Agent")?.slice(0, 240) ?? null;
  const memberName = await readHomeMemberName(env, tornUserId);
  const result = await env.DB.prepare(
    `
    INSERT INTO member_suggestions (
      torn_user_id,
      member_name,
      suggestion,
      user_agent,
      created_at
    )
    VALUES (?, ?, ?, ?, ?)
    `,
  )
    .bind(tornUserId, memberName, suggestion, userAgent, now)
    .run();

  return json({
    ok: true,
    suggestion: {
      id: Number(result.meta?.last_row_id ?? 0),
      torn_user_id: tornUserId,
      member_name: memberName,
      suggestion,
      created_at: now,
    },
  });
}

export async function listMemberSuggestionsForAdmin(url: URL, env: Env): Promise<Response> {
  const limit = parseLimit(
    url.searchParams.get("limit"),
    DEFAULT_ADMIN_SUGGESTION_LIMIT,
    MAX_ADMIN_SUGGESTION_LIMIT,
  );
  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT
        id,
        torn_user_id,
        member_name,
        suggestion,
        created_at
      FROM member_suggestions
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      `,
    )
      .bind(limit)
      .all<MemberSuggestion>(),
    env.DB.prepare(
      `
      SELECT COUNT(*) AS count
      FROM member_suggestions
      `,
    ).first<{ count: number | null }>(),
  ]);

  return json({
    ok: true,
    total_suggestions: Number(countRow?.count ?? 0),
    suggestions: rows.results ?? [],
  });
}

async function readHomeMemberName(env: Env, tornUserId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `
    SELECT name
    FROM home_faction_members
    WHERE member_id = ?
    LIMIT 1
    `,
  )
    .bind(tornUserId)
    .first<{ name: string | null }>();

  return row?.name ?? null;
}
