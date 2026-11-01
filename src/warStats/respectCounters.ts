type RespectDirection = "outgoing" | "incoming";

// Preserve the existing AVG semantics, including NULL/unknown attackers and
// the tracker-wide fallback. Zero-count rows left by deletions have no average.
export function memberRespectAveragesSql(direction: RespectDirection, idColumn = "attacker_id"): string {
  return `SELECT war_id, NULLIF(attacker_id, 0) AS ${idColumn},
    respect_sum * 1.0 / hit_count AS avg_respect
    FROM war_respect_totals WHERE war_id = ? AND direction = '${direction}' AND hit_count > 0`;
}

export function respectAverageSql(direction: RespectDirection): string {
  return `SELECT SUM(respect_sum) * 1.0 / NULLIF(SUM(hit_count), 0) AS avg_respect
    FROM war_respect_totals WHERE war_id = ? AND direction = '${direction}' AND hit_count > 0`;
}
