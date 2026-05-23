import { HOME_FACTION_ID } from "./constants";
import { Env } from "./types";
import { json, nowSeconds, parseLimit } from "./utils";

const DEFAULT_RECENT_ATTACK_LIMIT = 10;
const MAX_RECENT_ATTACK_LIMIT = 25;
const DEFAULT_RECENT_ATTACK_WINDOW_SECONDS = 5 * 60;
const MAX_RECENT_ATTACK_WINDOW_SECONDS = 60 * 60;
const RECENT_ATTACK_SELECT_COLUMNS = `
  id,
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
  const since = nowSeconds() - windowSeconds;

  const [outgoingRows, incomingRows] = await Promise.all([
    env.DB.prepare(
      `
      SELECT ${RECENT_ATTACK_SELECT_COLUMNS}
      FROM attacks
      WHERE attacker_faction_id = ?
        AND started IS NOT NULL
        AND started >= ?
      ORDER BY started DESC, id DESC
      LIMIT ?
      `,
    )
      .bind(HOME_FACTION_ID, since, limit)
      .all(),
    env.DB.prepare(
      `
      SELECT ${RECENT_ATTACK_SELECT_COLUMNS}
      FROM attacks
      WHERE defender_faction_id = ?
        AND started IS NOT NULL
        AND started >= ?
      ORDER BY started DESC, id DESC
      LIMIT ?
      `,
    )
      .bind(HOME_FACTION_ID, since, limit)
      .all(),
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

function parseWindowSeconds(value: string | null): number {
  if (!value) {
    return DEFAULT_RECENT_ATTACK_WINDOW_SECONDS;
  }

  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RECENT_ATTACK_WINDOW_SECONDS;
  }

  return Math.min(parsed, MAX_RECENT_ATTACK_WINDOW_SECONDS);
}
