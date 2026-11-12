import type { RecruitmentCandidate, RecruitmentResults, RecruitmentSnapshot } from '../shared/recruitment';
import type { Env } from './types';
import { nowSeconds } from './utils';

// A single transaction publishes metadata and all chunks together. Its first
// statement advances the version only when either input version has changed.
export async function rebuildRecruitmentResults(env: Env) {
  const current = await env.DB.prepare(`SELECT 1 AS ready FROM recruitment_result_state v
    JOIN recruitment_results r ON r.version = v.version JOIN recruitment_current_snapshot c ON c.id = 1
    WHERE v.id = 1 AND r.snapshot_id IS c.snapshot_id AND r.stats_version = v.stats_version`).first();
  if (current) {
    await env.DB.prepare(`UPDATE recruitment_scan SET results_pending = 0 WHERE id = 1 AND results_pending <> 0
      AND EXISTS (SELECT 1 FROM recruitment_result_state v JOIN recruitment_results r ON r.version = v.version
        JOIN recruitment_current_snapshot c ON c.id = 1
        WHERE v.id = 1 AND r.snapshot_id IS c.snapshot_id AND r.stats_version = v.stats_version)`).run();
    return;
  }
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(`UPDATE recruitment_result_state SET version = version + 1 WHERE id = 1
      AND NOT EXISTS (SELECT 1 FROM recruitment_results r, recruitment_current_snapshot c
        WHERE c.id = 1 AND r.version = recruitment_result_state.version
          AND r.snapshot_id IS c.snapshot_id AND r.stats_version = recruitment_result_state.stats_version)`),
    env.DB.prepare(`INSERT INTO recruitment_results(version, snapshot_id, stats_version, snapshot_json, built_at)
      SELECT v.version, c.snapshot_id, v.stats_version,
        CASE WHEN s.id IS NULL THEN 'null' ELSE json_object('id',s.id,'snapshot_date',s.snapshot_date,
          'imported_at',s.imported_at,'total_players',s.total_players,'unemployed',s.unemployed,
          'city_jobs',s.city_jobs,'excluded_fed',s.excluded_fed) END, ?
      FROM recruitment_result_state v JOIN recruitment_current_snapshot c ON c.id = 1
      LEFT JOIN recruitment_snapshots s ON s.id = c.snapshot_id
      WHERE v.id = 1 AND NOT EXISTS (SELECT 1 FROM recruitment_results WHERE version = v.version)`).bind(now),
    env.DB.prepare(`INSERT INTO recruitment_result_chunks(version, chunk_id, body)
      SELECT version, chunk_id, json_group_array(json(candidate)) FROM (
        SELECT v.version, (ROW_NUMBER() OVER (ORDER BY w.total_work_stats DESC, p.player_id) - 1) / 500 AS chunk_id,
          json_object('player_id',p.player_id,'username',p.username,'city_job',p.city_job,'level',p.level,
            'faction_id',p.faction_id,'total_work_stats',w.total_work_stats,'hof_position',w.hof_position,
            'work_stats_checked_at',w.work_stats_checked_at) AS candidate
        FROM recruitment_result_state v JOIN recruitment_results r ON r.version = v.version
        JOIN recruitment_snapshot_players p ON p.snapshot_id = r.snapshot_id
        LEFT JOIN recruitment_work_stats w ON w.player_id = p.player_id
        WHERE v.id = 1 AND changes() > 0
        ORDER BY w.total_work_stats DESC, p.player_id
      ) GROUP BY version, chunk_id`),
    env.DB.prepare('UPDATE recruitment_scan SET results_pending = 0 WHERE id = 1'),
    env.DB.prepare(`DELETE FROM recruitment_results WHERE built_at < ?
      AND version <> (SELECT version FROM recruitment_result_state WHERE id = 1)`).bind(now - 86400),
  ]);
}

// Reading saved results never queries the source snapshot or the HOF table.
export async function readRecruitmentResults(env: Env): Promise<RecruitmentResults> {
  const rows = await env.DB.prepare(`SELECT r.version, r.snapshot_id, r.snapshot_json, c.body
    FROM recruitment_result_state v JOIN recruitment_results r ON r.version = v.version
    LEFT JOIN recruitment_result_chunks c ON c.version = r.version WHERE v.id = 1 ORDER BY c.chunk_id`)
    .all<{version:number; snapshot_id:string|null; snapshot_json:string; body:string|null}>();
  const candidates: RecruitmentCandidate[] = rows.results.flatMap(row => row.body ? JSON.parse(row.body) : []);
  const matched = candidates.filter(p => p.total_work_stats !== null).length;
  return { candidates, total:candidates.length, matched, unknown:candidates.length-matched, page:0,
    snapshot_id:rows.results[0]?.snapshot_id ?? null, version:rows.results[0]?.version ?? 0,
    snapshot: rows.results[0] ? JSON.parse(rows.results[0].snapshot_json) as RecruitmentSnapshot | null : null };
}
