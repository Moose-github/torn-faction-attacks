function addNumericStatSql(column: string): string {
  return `${column} = war_member_stats.${column} + excluded.${column}`;
}

function appendTextStatSql(column: string, separatorSql: string): string {
  return `${column} = CASE
        WHEN war_member_stats.${column} = '' THEN excluded.${column}
        WHEN excluded.${column} = '' THEN war_member_stats.${column}
        ELSE war_member_stats.${column} || ${separatorSql} || excluded.${column}
      END`;
}

const ACTION_TIME_MERGE_SQL = `
      first_action_at = CASE
        WHEN war_member_stats.first_action_at IS NULL THEN excluded.first_action_at
        WHEN excluded.first_action_at IS NULL THEN war_member_stats.first_action_at
        ELSE MIN(war_member_stats.first_action_at, excluded.first_action_at)
      END,
      last_action_at = CASE
        WHEN war_member_stats.last_action_at IS NULL THEN excluded.last_action_at
        WHEN excluded.last_action_at IS NULL THEN war_member_stats.last_action_at
        ELSE MAX(war_member_stats.last_action_at, excluded.last_action_at)
      END`;

export const ATTACK_MEMBER_STAT_MERGE_SQL = `
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      ${addNumericStatSql("attacks_vs_enemy_total")},
      ${addNumericStatSql("attacks_vs_enemy_successful")},
      ${addNumericStatSql("respect_gained")},
      ${addNumericStatSql("respect_gained_raw")},
      ${addNumericStatSql("chain_bonus_hits_vs_enemy")},
      ${addNumericStatSql("chain_bonus_respect_removed")},
      ${appendTextStatSql("chain_bonus_hit_values_vs_enemy", "', '")},
      ${appendTextStatSql("chain_bonus_hit_details_vs_enemy", "char(10)")},
      ${addNumericStatSql("assists_vs_enemy")},
      ${addNumericStatSql("hospitalizations_vs_enemy")},
      ${addNumericStatSql("mugs_vs_enemy")},
      ${addNumericStatSql("retaliations_vs_enemy")},
      ${addNumericStatSql("outside_hits")},
      ${addNumericStatSql("friendly_hosps")},
      average_fair_fight = CASE
        WHEN war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total > 0 THEN
          (
            COALESCE(war_member_stats.average_fair_fight, 0) * war_member_stats.attacks_vs_enemy_total +
            COALESCE(excluded.average_fair_fight, 0) * excluded.attacks_vs_enemy_total
          ) / (war_member_stats.attacks_vs_enemy_total + excluded.attacks_vs_enemy_total)
        ELSE COALESCE(excluded.average_fair_fight, war_member_stats.average_fair_fight)
      END,
${ACTION_TIME_MERGE_SQL}`;

export const DEFEND_MEMBER_STAT_MERGE_SQL = `
      member_name = COALESCE(excluded.member_name, war_member_stats.member_name),
      ${addNumericStatSql("defends_total")},
      ${addNumericStatSql("defends_won")},
      ${addNumericStatSql("defends_other")},
      ${addNumericStatSql("defends_lost_non_hospitalized")},
      ${addNumericStatSql("respect_lost")},
      ${addNumericStatSql("respect_lost_non_hospitalized")},
      ${addNumericStatSql("respect_lost_raw")},
      ${addNumericStatSql("enemy_chain_bonus_hits_received")},
      ${addNumericStatSql("enemy_chain_bonus_respect_removed")},
      ${appendTextStatSql("enemy_chain_bonus_hit_values_received", "', '")},
      ${appendTextStatSql("enemy_chain_bonus_hit_details_received", "char(10)")},
${ACTION_TIME_MERGE_SQL}`;
