import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";
import { json, parseLimit } from "./utils";

const DEFAULT_RECENT_ATTACK_LIMIT = 10;
const MAX_RECENT_ATTACK_LIMIT = 25;
const MAX_RECENT_ATTACK_WINDOW_SECONDS = 60 * 60;
const RECENT_ATTACK_SELECT_COLUMNS = `
  id,
  code,
  started,
  ended,
  attacker_id,
  attacker_name,
  attacker_faction_id,
  attacker_faction_name,
  defender_id,
  defender_name,
  defender_faction_id,
  defender_faction_name,
  result,
  respect_gain,
  respect_loss,
  chain
`;

type RecentFactionAttackRow = {
  id: number;
  code: string | null;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  attacker_faction_id: number | null;
  attacker_faction_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number | null;
  respect_loss: number | null;
  chain: number | null;
};

export async function getRecentFactionAttacks(url: URL, env: Env): Promise<Response> {
  const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_RECENT_ATTACK_LIMIT, MAX_RECENT_ATTACK_LIMIT);
  const windowSeconds = parseWindowSeconds(url.searchParams.get("window_seconds"));
  const since = windowSeconds === null ? null : Math.floor(Date.now() / 1000) - windowSeconds;
  const windowFilter = since === null ? "" : "AND started >= ?";

  const outgoingStatement = env.DB.prepare(
    `
      SELECT ${RECENT_ATTACK_SELECT_COLUMNS}
      FROM attacks
      WHERE attacker_faction_id = ?
        AND started IS NOT NULL
        ${windowFilter}
      ORDER BY started DESC, id DESC
      LIMIT ?
      `,
  ).bind(...(since === null ? [HOME_FACTION_ID, limit] : [HOME_FACTION_ID, since, limit]));
  const incomingStatement = env.DB.prepare(
    `
      SELECT ${RECENT_ATTACK_SELECT_COLUMNS}
      FROM attacks
      WHERE defender_faction_id = ?
        AND started IS NOT NULL
        ${windowFilter}
      ORDER BY started DESC, id DESC
      LIMIT ?
      `,
  ).bind(...(since === null ? [HOME_FACTION_ID, limit] : [HOME_FACTION_ID, since, limit]));

  const [outgoingRows, incomingRows] = await env.DB.batch<RecentFactionAttackRow>([
    outgoingStatement,
    incomingStatement,
  ]);

  const rowsById = new Map<number, RecentFactionAttackRow>();
  for (const attack of [
    ...((outgoingRows.results ?? []) as RecentFactionAttackRow[]),
    ...((incomingRows.results ?? []) as RecentFactionAttackRow[]),
  ]) {
    rowsById.set(attack.id, attack);
  }

  const attacks = [...rowsById.values()]
    .sort((left, right) => {
      const startedDiff = (right.started ?? 0) - (left.started ?? 0);
      if (startedDiff !== 0) return startedDiff;
      return right.id - left.id;
    })
    .slice(0, limit)
    .map((attack) => ({
      ...attack,
      direction: attack.attacker_faction_id === HOME_FACTION_ID ? "outgoing" : "incoming",
    }));

  return json({
    ok: true,
    faction_id: HOME_FACTION_ID,
    window_seconds: windowSeconds,
    limit,
    since,
    attacks,
  });
}

function parseWindowSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, MAX_RECENT_ATTACK_WINDOW_SECONDS);
}
