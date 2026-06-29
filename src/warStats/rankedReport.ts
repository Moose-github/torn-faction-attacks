import { Env, TornRankedWarReportMember } from "../types";

export type RankedWarReportStatsResult = {
  home_report_members: number;
  added_from_report_members: number;
};

export async function applyRankedWarReportStats(
  env: Env,
  options: {
    warId: number;
    homeMembers: TornRankedWarReportMember[];
  },
): Promise<RankedWarReportStatsResult> {
  const existingMemberRows = await env.DB.prepare(
    `
    SELECT member_id
    FROM war_member_stats
    WHERE war_id = ?
    `,
  )
    .bind(options.warId)
    .all();

  const existingMemberIds = new Set(
    (existingMemberRows.results ?? []).map((row: any) => Number(row.member_id)),
  );
  const missingMembers = options.homeMembers.filter(
    (member) => !existingMemberIds.has(member.id),
  );

  if (missingMembers.length > 0) {
    await env.DB.batch(
      missingMembers.map((member) =>
        env.DB.prepare(
          `
          INSERT INTO war_member_stats (
            war_id,
            member_id,
            member_name,
            attacks_vs_enemy_total,
            attacks_vs_enemy_successful,
            respect_gained,
            assists_vs_enemy,
            hospitalizations_vs_enemy,
            mugs_vs_enemy,
            retaliations_vs_enemy,
            outside_hits,
            friendly_hosps,
            defends_total,
            defends_won,
            defends_other,
            respect_lost,
            added_from_report
          )
          VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
          `,
        ).bind(options.warId, member.id, member.name ?? null),
      ),
    );
  }

  return {
    home_report_members: options.homeMembers.length,
    added_from_report_members: missingMembers.length,
  };
}
