import { Env } from "../types";

export async function rebuildWarSummaryFromMemberStats(env: Env, warId: number): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO war_summary (
      war_id,
      attacks_vs_enemy_total,
      attacks_from_enemy_total,
      outside_hits,
      total_respect_gain,
      total_respect_gain_raw,
      total_respect_lost,
      total_respect_lost_raw,
      unique_attackers,
      first_attack_at,
      last_attack_at,
      updated_at
    )
    SELECT
      w.id,
      COALESCE(SUM(wms.attacks_vs_enemy_total), 0) AS attacks_vs_enemy_total,
      COALESCE(SUM(wms.defends_total), 0) AS attacks_from_enemy_total,
      COALESCE(SUM(wms.outside_hits), 0) AS outside_hits,
      COALESCE(SUM(wms.respect_gained), 0) AS total_respect_gain,
      COALESCE(SUM(wms.respect_gained_raw), 0) AS total_respect_gain_raw,
      COALESCE(SUM(wms.respect_lost), 0) AS total_respect_lost,
      COALESCE(SUM(wms.respect_lost_raw), 0) AS total_respect_lost_raw,
      COUNT(CASE
        WHEN wms.attacks_vs_enemy_total > 0
          OR wms.assists_vs_enemy > 0
          OR wms.outside_hits > 0
          OR wms.friendly_hosps > 0
        THEN 1
      END) AS unique_attackers,
      MIN(wms.first_action_at) AS first_attack_at,
      MAX(wms.last_action_at) AS last_attack_at,
      unixepoch() AS updated_at
    FROM wars w
    LEFT JOIN war_member_stats wms ON wms.war_id = w.id
    WHERE w.id = ?
    GROUP BY w.id
    ON CONFLICT(war_id) DO UPDATE SET
      attacks_vs_enemy_total = excluded.attacks_vs_enemy_total,
      attacks_from_enemy_total = excluded.attacks_from_enemy_total,
      outside_hits = excluded.outside_hits,
      total_respect_gain = excluded.total_respect_gain,
      total_respect_gain_raw = excluded.total_respect_gain_raw,
      total_respect_lost = excluded.total_respect_lost,
      total_respect_lost_raw = excluded.total_respect_lost_raw,
      unique_attackers = excluded.unique_attackers,
      first_attack_at = excluded.first_attack_at,
      last_attack_at = excluded.last_attack_at,
      updated_at = excluded.updated_at
    `,
  )
    .bind(warId)
    .run();
}
