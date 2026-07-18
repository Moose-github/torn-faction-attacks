export type WarType = "all" | "real" | "termed" | "event";

export type GlobalWarState = "none" | "upcoming" | "current" | "practically_finished";
export type EnemyStatsImagePreviewType = "comparison" | "members";

export type OverallStats = {
  total_wars: number;
  attacks_vs_enemy_total: number;
  attacks_from_enemy_total: number;
  outside_hits: number;
  total_respect_gain: number;
  total_respect_gain_raw: number;
  total_respect_lost: number;
  total_respect_lost_raw: number;
  latest_attack_started: number | null;
};

export type MemberStats = {
  member_id: number;
  member_name: string | null;
  wars_participated: number;
  attacks_vs_enemy_total: number;
  attacks_vs_enemy_successful: number;
  respect_gained: number;
  respect_gained_raw: number;
  chain_bonus_hits_vs_enemy: number;
  chain_bonus_respect_removed: number;
  chain_bonus_hit_values_vs_enemy: string;
  chain_bonus_hit_details_vs_enemy: string;
  assists_vs_enemy: number;
  hospitalizations_vs_enemy: number;
  mugs_vs_enemy: number;
  retaliations_vs_enemy: number;
  outside_hits: number;
  friendly_hosps: number;
  average_fair_fight: number | null;
  member_respect_limit_percent: number | null;
  defends_total: number;
  defends_won: number;
  defends_other: number;
  defends_lost_non_hospitalized?: number;
  respect_lost: number;
  respect_lost_non_hospitalized?: number;
  respect_lost_raw: number;
  enemy_chain_bonus_hits_received: number;
  enemy_chain_bonus_respect_removed: number;
  enemy_chain_bonus_hit_values_received: string;
  enemy_chain_bonus_hit_details_received: string;
  first_seen_at: number | null;
  last_seen_at: number | null;
  added_from_report?: number;
  is_current_member?: number;
};

export type StatsResponse = {
  ok: boolean;
  war_type: Exclude<WarType, "all"> | null;
  current_members_only?: boolean;
  overall: OverallStats;
  members: MemberStats[];
};

export type HomeFactionMemberSummary = {
  ok: boolean;
  faction_id: number;
  current_members: number;
  reportable_members: number;
  report_exempt_members: number;
  revivable_members: number;
  stat_estimates: number;
  networth_estimates: number;
  updated_at: number | null;
};

export type HomeFactionReportExemptionMember = {
  member_id: number;
  name: string;
  position: string | null;
  is_current: number;
  report_exempt: number;
  report_exempt_reason: string | null;
  report_exempt_updated_at: number | null;
};

export type HomeFactionReportExemptionsResponse = {
  ok: boolean;
  faction_id: number;
  members: HomeFactionReportExemptionMember[];
};

export type RecentFactionAttack = {
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
  direction: "incoming" | "outgoing";
};

export type RecentFactionAttacksResponse = {
  ok: boolean;
  faction_id: number;
  window_seconds: number | null;
  limit: number;
  since: number | null;
  attacks: RecentFactionAttack[];
};

export type WarSummary = {
  id: number;
  name: string;
  status: string;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
  enemy_faction_id: number | null;
  war_type: Exclude<WarType, "all"> | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  member_respect_limit: number | null;
  winner_faction_id: number | null;
  torn_report_fetched_at: number | null;
  official_home_score: number | null;
  official_home_attacks: number | null;
  official_enemy_score: number | null;
  official_enemy_attacks: number | null;
  enemy_scouting_auto_attempted_at: number | null;
  enemy_scouting_status_checked_at: number | null;
  finalized_at: number | null;
  attacks_vs_enemy_total: number;
  attacks_from_enemy_total: number;
  outside_hits: number;
  total_respect_gain: number;
  total_respect_gain_raw: number;
  total_respect_lost: number;
  total_respect_lost_raw: number;
  unique_attackers: number;
  first_attack_at: number | null;
  last_attack_at: number | null;
  summary_updated_at: number | null;
};

export type WarsResponse = {
  ok: boolean;
  war_state: GlobalWarState;

  active_war_id: number | null;

  wars: WarSummary[];
};

export type WarDetailResponse = {
  ok: boolean;
  war: WarSummary;
  summary: {
    war_id: number;
    attacks_vs_enemy_total: number;
    attacks_from_enemy_total: number;
    outside_hits: number;
    total_respect_gain: number;
    total_respect_gain_raw: number;
    total_respect_lost: number;
    total_respect_lost_raw: number;
    unique_attackers: number;
    first_attack_at: number | null;
    last_attack_at: number | null;
    updated_at: number;
  } | null;
  members: MemberStats[];
};

export type WarChainBonusesResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
  };
  chain_bonuses: ChainBonusAttack[];
};

export type MemberAttackClassification =
  | "enemy_success"
  | "enemy_assist"
  | "retaliation"
  | "enemy_attempt"
  | "outside"
  | "defend_lost"
  | "defend_won"
  | "defend_other"
  | "other";

export type MemberAttack = {
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
  respect_gain: number;
  respect_loss: number;
  m_retaliation?: number | null;
  classification: MemberAttackClassification;
};

export type ChainBonusAttack = Pick<
  MemberAttack,
  | "id"
  | "started"
  | "attacker_id"
  | "attacker_name"
  | "attacker_faction_id"
  | "attacker_faction_name"
  | "defender_id"
  | "defender_name"
  | "defender_faction_id"
  | "defender_faction_name"
  | "result"
  | "respect_gain"
  | "respect_loss"
> & {
  chain: number | null;
  adjusted_respect_gain?: number | null;
  respect_removed?: number | null;
};

export type MemberAttacksResponse = {
  ok: boolean;
  member_id: number;
  paging: {
    returned: number;
  };
  attacks: MemberAttack[];
};

export type WarActivityBucket = {
  bucket_start: number;
  enemy_success: number;
  enemy_assist: number;
  outside: number;
  defend_lost: number;
  defend_won: number;
  defend_other: number;
};

export type WarActivityResponse = {
  ok: boolean;
  bucket_minutes: number;
  window: "practical" | "official";
  buckets: WarActivityBucket[];
};

export type WarMemberCombatMetric =
  | "attacks_successful"
  | "outside_hits"
  | "defends_lost"
  | "respect_gained"
  | "respect_lost";

export type WarMemberCombatMember = {
  member_id: number;
  member_name: string | null;
  attacks_vs_enemy_successful: number;
  outside_hits: number;
  defends_total: number;
  defends_won: number;
  defends_other: number;
  respect_gained: number;
  respect_lost: number;
};

export type WarMemberCombatBucket = Record<WarMemberCombatMetric, number> & {
  war_id: number;
  member_id: number;
  bucket_start: number;
};

export type WarMemberCombatHeatmapResponse = {
  ok: boolean;
  bucket_minutes: number;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
    practical_start_time: number;
    practical_finish_time: number | null;
    official_start_time: number | null;
    official_end_time: number | null;
  };
  time_buckets: number[];
  members: WarMemberCombatMember[];
  buckets: WarMemberCombatBucket[];
};

export type FactionActivityHeatmapRow = {
  faction_id: number;
  date: string;
  interval_index: number;
  active_count: number;
  total_count: number;
  sampled_at: number;
};

export type FactionActivityHeatmapResponse = {
  ok: boolean;
  interval_minutes: number;
  war: {
    id: number;
    name: string;
    status?: string;
    practical_finish_time?: number | null;
    official_end_time?: number | null;
    enemy_faction_id: number | null;
  };
  home_faction_id: number;
  rows: FactionActivityHeatmapRow[];
};

export type RetaliationStatus = "available" | "claimed_pending" | "claimed_confirmed" | "expired" | "none";

export type RetaliationAttack = {
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
  m_retaliation?: number | null;
  attack_at: number | null;
};

export type PendingRetaliationClaim = {
  opening_attack_id: number;
  target_id: number;
  claimant_torn_user_id: number;
  claimant_name: string | null;
  source: "dashboard" | "tampermonkey";
  attack_url: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

export type RetaliationOpportunity = {
  target_id: number;
  opening_attack_id: number | null;
  status: RetaliationStatus;
  available: boolean;
  reason: "available" | "claimed" | "none";
  enemy_attack: RetaliationAttack | null;
  claimed_by_attack: RetaliationAttack | null;
  pending_claim: PendingRetaliationClaim | null;
  expires_at: number | null;
};

export type RetaliationSyncStatus = {
  status: string;
  last_success_at: number | null;
  warning: string | null;
  result: unknown | null;
};

export type RetaliationsResponse = {
  ok: boolean;
  checked_at: number;
  window_seconds: number;
  claim_ttl_seconds: number;
  fresh: boolean;
  sync: RetaliationSyncStatus;
  retaliations: RetaliationOpportunity[];
};

export type RetaliationClaimResponse = {
  ok: boolean;
  checked_at: number;
  window_seconds: number;
  claim_ttl_seconds: number;
  fresh: boolean;
  sync: RetaliationSyncStatus;
  retaliation: RetaliationOpportunity;
};

export type EnemyMemberActivityHeatmapRow = {
  war_id: number;
  faction_id: number;
  member_id: number;
  member_name: string;
  date: string;
  interval_index: number;
  is_recently_active: number;
  last_action_status: string | null;
  last_action_timestamp: number | null;
  sampled_at: number;
};

export type EnemyMemberActivityHeatmapResponse = {
  ok: boolean;
  interval_minutes: number;
  war: {
    id: number;
    name: string;
    practical_finish_time?: number | null;
    official_end_time?: number | null;
    enemy_faction_id: number | null;
  };
  rows: EnemyMemberActivityHeatmapRow[];
};

export type EnemyBigHitter = {
  war_id: number;
  faction_id: number;
  member_id: number;
  member_name: string;
  created_at: number;
  ff_battlestats: number | null;
  ff_battlestats_updated_at: number | null;
  bsp_battlestats: number | null;
  bsp_battlestats_updated_at: number | null;
  level: number | null;
  position: string | null;
  status_state: string | null;
  last_action_status: string | null;
  last_action_timestamp: number | null;
};

export type EnemyBigHittersResponse = {
  ok: boolean;
  threshold: number;
  deleted?: number;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
  };
  big_hitters: EnemyBigHitter[];
};

export type EnemyFactionMember = {
  member_id: number;
  faction_id: number;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number | null;
  ff_battlestats: number | null;
  ff_battlestats_updated_at: number | null;
  bsp_battlestats: number | null;
  bsp_battlestats_updated_at: number | null;
  networth: number | null;
  networth_updated_at: number | null;

  networth_attempted_at: number | null;

  networth_attempt_count: number | null;

  networth_error: string | null;

  networth_key_source: string | null;
  status_state?: string | null;
  status_description?: string | null;
  plane_image_type?: string | null;
  plane_type_label?: string | null;
  travel_type?: string | null;
  travel_type_note?: string | null;
  travel_time_note?: string | null;
  arrival_note?: string | null;
  is_travel_time_range?: boolean;
  return_travel_type?: string | null;
  return_travel_time_seconds?: number | null;
  return_travel_time_note?: string | null;
  travel_origin?: string | null;
  travel_destination?: string | null;
  travel_signature?: string | null;
  travel_detected_at?: number | null;
  travel_started_after?: number | null;
  travel_started_before?: number | null;
  estimated_arrival_at?: number | null;
  estimated_arrival_earliest?: number | null;
  estimated_arrival_latest?: number | null;
  travel_trip_destination?: string | null;
  travel_trip_type?: string | null;
  travel_trip_inferred_at?: number | null;
  last_action_status?: string | null;
  last_action_timestamp?: number | null;
  status_updated_at?: number | null;
  updated_at: number;
};

export type EnemyScoutingResponse = {
  ok: boolean;
  refreshed: boolean;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
  };
  summary: {
    members_loaded: number;
    average_level: number;
    average_ff_battlestats: number | null;
    missing_ff_battlestats: number;
    stats_available: number;
    networth_available: number;

    networth_pending: number;

    networth_failed: number;

    networth_retryable: number;
    traveling: number;
    status_checked_at: number | null;
  };
  members: EnemyFactionMember[];
};

export type ScoutingComparisonResponse = {
  ok: boolean;
  comparison_stats_complete?: boolean;

  hit_stats?: {

    health: EnemyHitStatHealth;

    trends: EnemyHitStatTrend[];

  };
  war: {
    id: number;
    name: string;
    status_checked_at?: number | null;
    enemy_faction_id: number | null;
  };
  home: {
    faction_id: number;
    members: EnemyFactionMember[];
  };
  enemy: {
    faction_id: number;
    members: EnemyFactionMember[];
  };
};

export type EnemyHitStatHealth = {

  total: number;

  completed: number;

  pending: number;

  failed: number;

  retryable: number;

};

export type ChainWatchState = {
  war_id: number;
  enabled: number;
  source: "stored" | "live_confirm" | "stale" | "dropped";
  current_chain: number | null;
  reset_at: number | null;
  timeout_at: number | null;
  last_hit_id: number | null;
  last_hit_at: number | null;
  last_hit_attacker_name: string | null;
  last_hit_defender_name: string | null;
  last_hit_result: string | null;
  scheduled_alarm_stage: "warning_60" | "warning_30" | "drop" | null;
  scheduled_alarm_at: number | null;
  warning_60_sent_at: number | null;
  warning_30_sent_at: number | null;
  drop_sent_at: number | null;
  alert_chain: number | null;
  alert_reset_at: number | null;
  last_checked_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

export type ChainWatchResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    status: string;
    practical_finish_time: number | null;
    official_end_time: number | null;
  };
  state: ChainWatchState | null;
  computed: {
    active: boolean;
    alert_eligible: boolean;
    remaining_seconds: number | null;
    dropped: boolean;
  };
};



export type EnemyHitStatTrend = {

  member_id: number;

  member_name: string;

  priority: "high" | "medium" | "low";

  snapshot_count: number;

  oldest_snapshot_date: string;

  latest_snapshot_date: string;

  weeks: number;

  rankedwarhits_per_week: number;

  retals_per_week: number;

  specialammoused_per_week: number;

  temphits_per_week: number;

  meleehits_per_week: number;

  gunhits_per_week: number;

  oldest_temphits: number;

  oldest_meleehits: number;

  oldest_gunhits: number;

  latest_temphits: number;

  latest_meleehits: number;

  latest_gunhits: number;

  snapshots: EnemyHitStatTrendSnapshot[];

};

export type EnemyHitStatTrendSnapshot = {

  snapshot_date: string;

  rankedwarhits: number | null;

  retals: number | null;

  specialammoused: number | null;

};



export type ReportDiscrepancyGroup = {
  count: number;
  respect_gain: number;
  attacks: Array<Pick<
    MemberAttack,
    | "id"
    | "started"
    | "attacker_id"
    | "attacker_name"
    | "attacker_faction_id"
    | "attacker_faction_name"
    | "defender_id"
    | "defender_name"
    | "defender_faction_id"
    | "defender_faction_name"
    | "result"
    | "respect_gain"
    | "respect_loss"
  > & Partial<Pick<ChainBonusAttack, "chain" | "adjusted_respect_gain" | "respect_removed">>>;
};

export type ReportDiscrepanciesResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    practical_start_time: number;
    practical_finish_time: number | null;
    official_start_time: number | null;
    official_end_time: number | null;
    enemy_faction_id: number | null;
    war_type: Exclude<WarType, "all">;
  };
  groups: Record<string, ReportDiscrepancyGroup>;
  member_report_comparison?: {
    available: boolean;
    totals: MemberReportComparisonTotals;
    mismatches: MemberReportComparisonRow[];
  };
  attack_reconciliation?: ReportAttackReconciliation | null;
};

export type MemberReportComparisonTotals = {
  local_attacks: number;
  report_attacks: number;
  attack_diff: number;
  local_raw_respect: number;
  report_score: number;
  respect_diff: number;
};

export type MemberReportComparisonRow = MemberReportComparisonTotals & {
  member_id: number;
  member_name: string | null;
};

export type ReportAttackReconciliation = {
  id: number;
  war_id: number;
  torn_report_fetched_at: number | null;
  official_start_time: number;
  official_end_time: number;
  member_ids: number[];
  status: "running" | "completed" | "failed";
  torn_attacks_fetched: number;
  comparable_torn_attacks: number;
  local_attacks_checked: number;
  findings_count: number;
  truncated: number;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  items: ReportAttackReconciliationItem[];
};

export type ReportAttackReconciliationItem = {
  id: number;
  run_id: number;
  war_id: number;
  member_id: number;
  member_name: string | null;
  attack_id: number | null;
  attack_code: string | null;
  source: "torn" | "local" | "both";
  classification: string;
  reason: string;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number | null;
  chain: number | null;
  local_war_id: number | null;
  local_included: number | null;
  torn_included: number | null;
};

export type AdminWarPayload = {
  id?: number;
  status?: string;
  name?: string;
  practical_start_time?: number;
  practical_finish_time?: number | null;
  official_start_time?: number | null;
  official_end_time?: number | null;
  enemy_faction_id?: number | null;
  war_type: Exclude<WarType, "all">;
  torn_war_id?: number | null;
  auto_end_enabled?: boolean;
  faction_respect_limit?: number | null;
  member_respect_limit?: number | null;
};

export type ShopliftingAlertSetting = {

  shop_key: "big_als" | "jewelry_store";

  shop_name: string;

  enabled: boolean;

  configurable: boolean;

};

export type EnemyPushAlertSetting = {

  key: "enemy_push";

  name: string;

  enabled: boolean;

  configurable: boolean;

};

export type EnemyScoutingReportAlertSetting = {

  key: "enemy_scouting_report";

  name: string;

  enabled: boolean;

  configurable: boolean;

};

export type XanaxCompetitionAlertSetting = {

  key: "xanax_competition";

  name: string;

  enabled: boolean;

  configurable: boolean;

};

export type TermedWarAutoEndAlertSetting = {

  key: "termed_war_auto_end";

  name: string;

  enabled: boolean;

  configurable: boolean;

};

export type ChainWatchAlertSetting = {

  key: "chain_watch";

  name: string;

  enabled: boolean;

  configurable: boolean;

};

export type RetaliationBoardAlertSetting = {

  key: "retaliation_board";

  name: string;

  enabled: boolean;

  configurable: boolean;

};



export type AdminDiscordAlertSettingsResponse = {

  ok: boolean;

  chain_watch_alert: ChainWatchAlertSetting;

  retaliation_board_alert: RetaliationBoardAlertSetting;

  alerts: ShopliftingAlertSetting[];

  enemy_push_alert: EnemyPushAlertSetting;

  enemy_scouting_report_alert: EnemyScoutingReportAlertSetting;

  xanax_competition_alert: XanaxCompetitionAlertSetting;

  termed_war_auto_end_alert: TermedWarAutoEndAlertSetting;

};

export type DiscordMemberAlertSubscription = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type DiscordMemberAlertSubscriptionsResponse = {
  ok: boolean;
  discord_link: {
    torn_user_id: number;
    discord_user_id: string | null;
    linked: boolean;
  };
  alerts: DiscordMemberAlertSubscription[];
};

export type AttackWindowPayload = {
  practical_start_time: number;
  practical_finish_time: number;
  limit?: number;
};

export type IngestionRun = {
  id: string;
  trigger_source: string;
  started_at: number;
  ranked_war_checked_at: number | null;
  attacks_fetch_finished_at: number | null;
  d1_writes_finished_at: number | null;
  stats_finished_at: number | null;
  report_finished_at: number | null;
  finished_at: number | null;
  latest_attack_started: number | null;
  fetched_pages: number;
  fetched_attacks: number;
  wrote_batches: number;
  saw_rows: number;
  active_war_id: number | null;
  status: string;
  error: string | null;
};

export type IngestionRunResponse = {
  ok: boolean;
  run: IngestionRun | null;
};

export type MaintenanceRun = {
  id: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  task_count: number;
  write_statements: number;
  changed_rows: number;
  error: string | null;
};

export type MaintenanceTask = {
  id: string;
  run_id: string;
  task_name: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  write_statements: number;
  changed_rows: number;
  details: string | null;
  error: string | null;
};

export type DailyStatsAttention = {
  stale_personalstats: number;
  missing_donator_days: number;
  personalstats_target_date: string | null;
  latest_personalstats_bucket_date: string | null;
  personalstats_lag_days: number | null;
  affected_members: Array<{
    member_id: number;
    member_name: string | null;
    error: string | null;
    updated_at: number | null;
  }>;
};

export type GymStatsHealth = {
  target_date: string | null;
  target_refresh_at: number | null;
  latest_gym_snapshot_date: string | null;
  gym_lag_days: number | null;
  completed_gym_stats: string[];
  missing_gym_stats: string[];
  stale_gym_members: number;
};

export type MaintenanceRunResponse = {
  ok: boolean;
  run: MaintenanceRun | null;
  tasks: MaintenanceTask[];
  daily_stats_attention?: DailyStatsAttention;
};

export type DataHealthStatus = "good" | "warn" | "critical" | "unknown";

export type DataHealthSettings = {
  ingestion_warn_seconds: number;
  ingestion_critical_seconds: number;
  maintenance_warn_seconds: number;
  maintenance_critical_seconds: number;
  daily_stats_lag_warn_days: number;
  daily_stats_lag_critical_days: number;
  stale_daily_members_warn: number;
  stale_daily_members_critical: number;
  api_error_rate_warn_percent: number;
  api_error_rate_critical_percent: number;
  api_rate_limited_warn: number;
  api_rate_limited_critical: number;
  stock_freshness_warn_seconds: number;
  stock_freshness_critical_seconds: number;
  stale_stocks_warn: number;
  stale_stocks_critical: number;
};

export type DataHealthMetric = {
  label: string;
  value: string;
  timestamp?: number | null;
  title?: string | null;
};

export type DataHealthSubsystem = {
  key: string;
  label: string;
  status: DataHealthStatus;
  summary: string;
  updated_at: number | null;
  updated_label?: string | null;
  metrics: DataHealthMetric[];
};

export type DataHealthIssue = {
  key: string;
  subsystem: string;
  status: Exclude<DataHealthStatus, "good">;
  title: string;
  detail: string;
  action_view: AppViewName | null;
  action_label: string | null;
};

export type PersonalStatsCoverageGap = {
  snapshot_date: string;
  member_id: number;
  member_name: string | null;
  latest_personal_ready_date: string | null;
  recent_snapshot_date: string | null;
  recent_status: string | null;
  recent_error: string | null;
  recent_updated_at: number | null;
};

export type DataHealthSummaryResponse = {
  ok: boolean;
  generated_at: number;
  cache_seconds: number;
  overall_status: DataHealthStatus;
  subsystems: DataHealthSubsystem[];
};

export type AdminDataHealthResponse = DataHealthSummaryResponse & {
  settings: DataHealthSettings;
  issues: DataHealthIssue[];
  details: {
    ingestion_run: IngestionRun | null;
    maintenance_run: MaintenanceRun | null;
    maintenance_tasks: MaintenanceTask[];
    daily_stats_attention: DailyStatsAttention;
    personal_stats_coverage_gaps: PersonalStatsCoverageGap[];
    gym_stats_health: GymStatsHealth;
    roster: {
      current_members: number;
      reportable_members: number;
      report_exempt_members: number;
      revivable_members: number;
      stat_estimates: number;
      networth_estimates: number;
      updated_at: number | null;
    };
    api_usage: TornApiUsageSummary;
    api_usage_window_seconds: number;
    api_key_health: TornApiUsageKey[];
    api_key_health_window_seconds: number;
    api_keys: TornApiUsageKey[];
    api_features: TornApiUsageFeature[];
    api_endpoints: TornApiUsageFeature[];
    api_recent_calls: TornApiUsageCall[];
    stock_run: StockIngestionRun | null;
    stock_coverage: StockCoverage;
    stock_last_error: string | null;
    war_reports: {
      missing_reports: number;
      oldest_missing_finished_at: number | null;
    };
    enemy_scouting_coverage: EnemyScoutingCoverageRow[];
    enemy_scouting_gaps: EnemyScoutingGapRow[];
  };
};

export type EnemyScoutingCoverageRow = {
  faction_id: number;
  war_names: string | null;
  total_members: number;
  ff_stats_available: number;
  bsp_stats_available: number;
  networth_available: number;
  networth_pending: number;
  networth_failed: number;
  networth_retryable: number;
  status_checked_at: number | null;
  updated_at: number | null;
};

export type EnemyScoutingGapRow = {
  faction_id: number;
  member_id: number;
  name: string;
  level: number | null;
  status_state: string | null;
  ff_battlestats: number | null;
  bsp_battlestats: number | null;
  networth: number | null;
  networth_attempted_at: number | null;
  networth_attempt_count: number | null;
  networth_error: string | null;
  updated_at: number | null;
};

type AppViewName =
  | "dashboard"
  | "war"
  | "warRoom"
  | "hospitalMonitor"
  | "members"
  | "lifestyle"
  | "miscellaneous"
  | "tradeScout"
  | "warPayouts"
  | "stockMarketStatus"
  | "diceGame"
  | "dataHealth"
  | "settings"
  | "admin";

export type TornApiUsageSummary = {
  window_seconds: number;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  max_duration_ms?: number | null;
  requests_per_minute?: number;
};

export type TornApiUsageFeature = {
  feature: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

export type TornApiUsageEndpoint = {
  endpoint: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
};

export type TornApiUsageKey = {
  key_source: string;
  requests: number;
  errors: number;
  rate_limited: number;
  avg_duration_ms: number | null;
  last_requested_at: number | null;
  calls_per_minute?: number;
};

export type TornApiUsageCall = {
  id: number;
  requested_at: number;
  feature: string;
  key_source: string;
  method: string;
  endpoint: string;
  status: number | null;
  ok: boolean;
  error: string | null;
  duration_ms: number;
  retry_attempt: number;
};

export type TornApiUsageResponse = {
  ok: boolean;
  window_seconds: number;
  summary: TornApiUsageSummary;
  windows: TornApiUsageSummary[];
  by_key: TornApiUsageKey[];
  by_feature: TornApiUsageFeature[];
  by_endpoint: TornApiUsageEndpoint[];
  recent_calls: TornApiUsageCall[];
};

export type MemberLifestyleRepairStatusCounts = {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
};

export type MemberLifestyleRepairItem = {
  id: string;
  member_id: number;
  member_name: string | null;
  snapshot_date: string;
  requested_at: number;
  status: string;
  attempts: number;
  key_source: string | null;
  returned_bucket_date: string | null;
  error: string | null;
  updated_at: number;
};

export type MemberLifestyleRepairJob = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  effective_start_date: string;
  member_scope: string;
  member_id: number | null;
  calls_per_minute_per_key: number;
  include_primary_key: boolean;
  active_key_count: number;
  total_items: number;
  completed_items: number;
  failed_items: number;
  skipped_items: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  alert_sent_at: number | null;
  last_error: string | null;
  status_counts?: MemberLifestyleRepairStatusCounts;
  recent_errors?: MemberLifestyleRepairItem[];
};

export type MemberLifestyleRepairJobsResponse = {
  ok: boolean;
  jobs: MemberLifestyleRepairJob[];
};

export type MemberLifestyleRepairJobResponse = {
  ok: boolean;
  job: MemberLifestyleRepairJob;
};

export type StockIngestionRun = {
  id: string;
  batch_group: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  stocks_attempted: number;
  stocks_succeeded: number;
  stocks_failed: number;
  points_seen: number;
  points_written: number;
  recoverable_gap_count: number;
  unrecoverable_gap_count: number;
  error: string | null;
  details_json: string | null;
};

export type StockCoverage = {
  total_stocks: number;
  stocks_with_snapshots: number;
  oldest_snapshot_at: number | null;
  newest_snapshot_at: number | null;
  stale_stocks: number;
};

export type StockIngestionStatusResponse = {
  ok: boolean;
  latest_run: StockIngestionRun | null;
  recent_runs: StockIngestionRun[];
  coverage: StockCoverage;
  primary_cadence: string;
  recovery_cadence: string;
  last_error: string | null;
};

export type StockBenefitValueSource = "cash" | "custom" | "market" | "default" | "unpriced";



export type StockInvestmentRoiRow = {

  investment_type: "stock" | "city_bank";

  row_id: string;

  stock_id: number | null;

  acronym: string | null;

  name: string | null;

  increment: number | null;

  required_shares: number | null;

  total_shares_required: number | null;

  latest_price: number | null;

  increment_cost: number;

  total_cost: number;

  benefit_key: string | null;

  benefit_description: string;

  valuation_source: StockBenefitValueSource;

  frequency_days: number;

  benefit_value: number;

  annual_return: number;

  days_to_break_even: number;

  roi_percent: number;

};



export type StockInvestmentRoiResponse = {

  ok: boolean;

  refreshed_at: number | null;

  benefit_prices_refreshed_at: number | null;

  rows: StockInvestmentRoiRow[];

  skipped: {

    passive: number;

    unpriced: number;

    invalid: number;

    disabled: number;

  };

};

export type StockBenefitStock = {

  stock_id: number;

  acronym: string | null;

  name: string | null;

};

export type StockBenefitDisabledStock = StockBenefitStock & {

  benefit_key: string;

  label: string | null;

  disabled_at: number;

};



export type StockBenefitValue = {

  benefit_key: string;

  label: string;

  default_value: number | null;

  override_value: number | null;

  effective_value: number | null;

  source: Exclude<StockBenefitValueSource, "cash">;

  used_by_stock_count: number;

  stocks: StockBenefitStock[];

};



export type StockBenefitValuesResponse = {

  ok: boolean;

  benefits: StockBenefitValue[];

  disabled_stocks: StockBenefitDisabledStock[];

};

export type StockBenefitItemPriceRefreshResponse = {

  ok: boolean;

  latched?: boolean;

  retry_after_seconds?: number;

  refreshed: number;

  skipped: number;

  failed: number;

  prices: Array<{

    benefit_key: string;

    label: string;

    market_type: string;

    torn_item_id: number | null;

    market_value: number | null;

    status: string;

    error: string | null;

  }>;

};



export type StockPaperAccount = {
  id: string;
  name: string;
  mode: string;
  status: string;
  strategy_key: string;
  starting_cash: number;
  cash_balance: number;
  realized_pnl: number;
  buy_fee_rate: number;
  sell_fee_rate: number;
  max_open_positions: number;
  max_position_fraction: number;
  min_cash_reserve_fraction: number;
  last_decision_at: number | null;
  created_at: number;
  updated_at: number;
};

export type StockPaperPosition = {
  account_id: string;
  stock_id: number;
  shares: number;
  average_entry_price: number;
  opened_at: number;
  updated_at: number;
  acronym: string | null;
  name: string | null;
  latest_price: number | null;
  market_value: number;
  unrealized_pnl: number;
};

export type StockPaperTrade = {
  id: string;
  account_id: string | null;
  simulation_run_id: string | null;
  stock_id: number;
  acronym: string | null;
  name: string | null;
  side: "buy" | "sell";
  shares: number;
  price: number;
  gross_value: number;
  fee: number;
  net_value: number;
  realized_pnl: number | null;
  executed_at: number;
  reason: string;
  score: number | null;
};

export type StockPaperEquitySnapshot = {
  id: string;
  account_id: string | null;
  simulation_run_id: string | null;
  observed_at: number;
  cash_balance: number;
  holdings_value: number;
  total_equity: number;
  realized_pnl: number;
  unrealized_pnl: number;
  exposure_fraction: number;
  created_at: number;
};

export type StockPaperSimulationRun = {
  id: string;
  strategy_key: string;
  started_at: number;
  finished_at: number | null;
  simulation_start_at: number | null;
  simulation_end_at: number | null;
  status: string;
  starting_cash: number;
  final_equity: number | null;
  return_percent: number | null;
  max_drawdown_percent: number | null;
  trade_count: number;
  win_trade_count: number;
  buy_fee_rate: number;
  sell_fee_rate: number;
  config_json: string | null;
  error: string | null;
};

export type StockPaperSignal = {
  stock_id: number;
  acronym: string | null;
  name: string | null;
  observed_at: number;
  price: number;
  score: number;
  expected_return: number;
  copy_side?: "buy" | "sell";
  copy_source_player_id?: number;
  copy_source_player_name?: string;
  copy_activity_status?: string | null;
  copy_activity_timestamp?: number | null;
  copy_reason?: string;
  copy_window_start_at?: number;
  flow_1m?: number | null;
  flow_threshold?: number | null;
  investor_change?: number | null;
  share_pressure?: number | null;
  market_cap_change?: number | null;
  rank: number;
};

export type StockCopyMovementEvent = {
  id: string;
  source_player_id: number;
  source_player_name: string;
  activity_status: string | null;
  activity_timestamp: number | null;
  observed_at: number;
  window_start_at: number;
  stock_id: number;
  side: "buy" | "sell";
  price: number;
  strength: number;
  price_change: number | null;
  investor_change: number | null;
  share_pressure: number | null;
  market_cap_change: number | null;
  status: "executed" | "skipped" | "ignored";
  reason: string;
  paper_trade_id: string | null;
  details_json: string | null;
  created_at: number;
};

export type StockPaperBotSummary = {
  bot: {
    id: string;
    name: string;
    strategy_key: string;
    strategy: string;
    default_starting_cash: number;
  };
  account: StockPaperAccount | null;
  positions: StockPaperPosition[];
  latest_equity: StockPaperEquitySnapshot | null;
  recent_trades: StockPaperTrade[];
  latest_signals: StockPaperSignal[];
  recent_copy_events: StockCopyMovementEvent[];
};

export type StockPaperStatusResponse = {
  ok: boolean;
  bots: StockPaperBotSummary[];
  account: StockPaperAccount | null;
  positions: StockPaperPosition[];
  latest_equity: StockPaperEquitySnapshot | null;
  recent_trades: StockPaperTrade[];
  latest_simulation: StockPaperSimulationRun | null;
  latest_simulation_trades: StockPaperTrade[];
  latest_signals: StockPaperSignal[];
  defaults: {
    starting_cash: number;
    buy_fee_rate: number;
    sell_fee_rate: number;
    max_open_positions: number;
    max_position_fraction: number;
    min_cash_reserve_fraction: number;
  };
};

export type StockPaperSimulationResponse = {
  ok: boolean;
  run: StockPaperSimulationRun;
  trades: StockPaperTrade[];
  equity: StockPaperEquitySnapshot[];
  latest_signals: StockPaperSignal[];
};

export type StockSnapshotExportRow = {
  stock_id: number;
  observed_at: number;
  price: number;
  market_cap: number | null;
  total_shares: number | null;
  investors: number | null;
};

export type StockSnapshotExportResponse = {
  ok: boolean;
  snapshots: StockSnapshotExportRow[];
  range: {
    start_at: number;
    end_at: number;
  };
  next_cursor: {
    after_at: number;
    after_stock_id: number;
  } | null;
};

export type MemberLifestyleStats = {
  member_id: number;
  member_name: string | null;
  overdosed: number;
  average_xantaken: number;
  adjusted_average_xantaken: number;
  average_refills: number;
  average_useractivity: number;
  networth: number | null;
  average_gymenergy: number;
  average_gymstrength: number;
  average_gymspeed: number;
  average_gymdefense: number;
  average_gymdexterity: number;
  first_snapshot_date: string | null;
  last_snapshot_date: string | null;
  updated_at: number | null;
};

export type MemberLifestyleDailyMetric =
  | "xantaken"
  | "overdosed"
  | "refills"
  | "useractivity"
  | "gymenergy"
  | "gymstrength"
  | "gymspeed"
  | "gymdefense"
  | "gymdexterity"
  | "networth";

export type MemberLifestyleDailyChartPoint = {
  date: string;
  value: number | null;
};

export type MemberLifestyleDailyChartSeries = {
  member_id: number;
  member_name: string | null;
  points: MemberLifestyleDailyChartPoint[];
};

export type MemberLifestyleDailyChartResponse = {
  ok: boolean;
  metric: MemberLifestyleDailyMetric;
  period: {
    start_date: string;
    end_date: string;
    available_start_date: string | null;
    available_end_date: string | null;
    days: number;
    max_days: number;
    capped: boolean;
  };
  series: MemberLifestyleDailyChartSeries[];
};

export type MemberLifestyleStatsResponse = {
  ok: boolean;
  period: {
    start_date: string;
    end_date: string;
    available_start_date: string | null;
    available_end_date: string | null;
    days: number;
    max_days: number;
    capped: boolean;
  };
  summary: {
    members: number;
    total_overdosed: number;
    total_xantaken: number;
    average_xantaken: number;
    adjusted_average_xantaken: number;
    average_refills: number;
    average_useractivity: number;
    average_networth: number;
    total_gymenergy: number;
    average_gymenergy: number;
    average_gymstrength: number;
    average_gymspeed: number;
    average_gymdefense: number;
    average_gymdexterity: number;
    oldest_updated_at: number | null;
  };
  members: MemberLifestyleStats[];
};

export type MemberAchievementSummary = {
  metric_key: string;
  metric_group: string;
  metric_title: string;
  period_key: string;
  rank: number;
  member_id: number;
  member_name: string | null;
  value: number;
  unit: string;
  period_start_date: string;
  period_end_date: string;
  source_snapshot_date: string | null;
  detail_json: string | null;
  computed_at: number;
};

export type MemberAchievementsResponse = {
  ok: boolean;
  achievements: MemberAchievementSummary[];
};

export type XanaxCompetitionProgress = {
  rank: number;
  member_id: number;
  member_name: string | null;
  monthly_xanax: number;
  remaining: number;
  eligible: boolean;
  latest_snapshot_date: string | null;
};

export type XanaxCompetitionSettings = {
  enabled: boolean;
  base_prize: number;
  rollover_count: number;
  current_prize: number;
  month_key: string;
};

export type XanaxCompetitionClaim = {
  id: number;
  month_key: string;
  member_id: number;
  member_name: string | null;
  xantaken: number;
  prize_paid: number;
  claimed_by_torn_user_id: number | null;
  claimed_at: number;
};

export type XanaxCompetitionResponse = {
  ok: boolean;
  settings: XanaxCompetitionSettings;
  current_user_progress: XanaxCompetitionProgress | null;
  leaderboard: XanaxCompetitionProgress[];
  latest_snapshot_date: string | null;
  updated_at: number;
};

export type AdminXanaxCompetitionResponse = XanaxCompetitionResponse & {
  claims: XanaxCompetitionClaim[];
};

export type MemberSuggestion = {
  id: number;
  torn_user_id: number;
  member_name: string | null;
  suggestion: string;
  created_at: number;
};

export type MemberSuggestionResponse = {
  ok: boolean;
  suggestion: MemberSuggestion;
};

export type AdminSuggestionsResponse = {
  ok: boolean;
  total_suggestions: number;
  suggestions: MemberSuggestion[];
};

export type ShopliftingObstacle = {
  title: string;
  disabled: boolean;
};

export type MiscellaneousResponse = {
  ok: boolean;
  shoplifting: Record<string, ShopliftingObstacle[]>;
  fetched_at: number | null;
  error: string | null;
};

export type EnemyPushPressureSnapshot = {
  war_id: number;
  faction_id: number;
  bucket_start: number;
  total_members: number;
  online_count: number;
  idle_count: number;
  offline_count: number;
  recently_active_count: number;
  offline_idle_to_online_count: number;
  enemy_attacks_last_5m: number;
  hospital_count: number;
  revivable_count: number;
  baseline_active_count: number | null;
  activity_above_baseline: number | null;
  online_delta_10m: number;
  recently_active_delta_10m: number;
  big_hitter_total_count: number;
  big_hitter_online_count: number;
  big_hitter_recently_active_count: number;
  big_hitter_pressure_multiplier: number;
  base_pressure_score: number;
  pressure_score: number;
  pressure_level: "quiet" | "building" | "likely" | "underway" | string;
  created_at: number;
};

export type EnemyPushPressureResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    status: string;
    practical_finish_time: number | null;
    official_end_time: number | null;
    enemy_faction_id: number | null;
  };
  control_state: string | null;
  push_interpretation_label: string;
  push_alerts_suppressed: boolean;
  push_alert_suppression_reason: string | null;
  latest: EnemyPushPressureSnapshot | null;
  history: EnemyPushPressureSnapshot[];
};

export type WarControlState =
  | "opening"
  | "home_control"
  | "enemy_control"
  | "contested"
  | "transitioning"
  | "unknown"
  | string;

export type WarControlSettings = {
  id: 1;
  control_hospital_threshold: number;
  available_advantage_min: number;
  opening_grace_minutes: number;
  min_observed_roster_percent: number;
  min_local_relevant_members: number;
  heavy_own_hospital_penalty_threshold: number;
  severe_own_hospital_penalty_threshold: number;
  heavy_own_hospital_confidence_penalty: number;
  severe_own_hospital_confidence_penalty: number;
  transition_hospital_ratio_drop: number;
  transition_window_minutes: number;
  transition_min_attacks_5m: number;
  transition_big_hitter_multiplier_one: number;
  transition_big_hitter_multiplier_multiple: number;
  updated_at: number;
};

export type WarControlSettingsUpdate = Partial<Omit<WarControlSettings, "id" | "updated_at">>;

export type WarControlSettingsResponse = {
  ok: boolean;
  settings: WarControlSettings;
};

export type WarControlSnapshot = {
  war_id: number;
  bucket_start: number;
  home_total_members: number;
  home_observed_members: number;
  home_observed_roster_percent: number;
  home_available_count: number;
  home_hospital_count: number;
  home_travel_count: number;
  home_unknown_count: number;
  home_local_relevant_count: number;
  enemy_total_members: number;
  enemy_observed_members: number;
  enemy_observed_roster_percent: number;
  enemy_available_count: number;
  enemy_hospital_count: number;
  enemy_travel_count: number;
  enemy_unknown_count: number;
  enemy_local_relevant_count: number;
  home_attacks_last_5m: number;
  enemy_attacks_last_5m: number;
  home_attacks_last_15m: number;
  enemy_attacks_last_15m: number;
  enemy_big_hitter_total_count: number;
  enemy_big_hitter_available_count: number;
  enemy_big_hitter_hospital_count: number;
  enemy_big_hitter_travel_count: number;
  enemy_big_hitter_recently_active_count: number;
  home_hospital_ratio: number;
  enemy_hospital_ratio: number;
  home_available_ratio: number;
  enemy_available_ratio: number;
  control_state: WarControlState;
  control_confidence: number;
  control_reason: string;
  reasons_json: string;
  reasons?: string[];
  created_at: number;
};

export type WarControlResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    status: string;
    practical_start_time: number;
    practical_finish_time: number | null;
    enemy_faction_id: number | null;
  };
  settings: WarControlSettings;
  latest: WarControlSnapshot | null;
  history: WarControlSnapshot[];
};

export type DiceGameProfile = {
  torn_user_id: number;
  member_name: string | null;
  xanax_balance: number;
  total_gained: number;
  total_lost: number;
  rolls: number;
  consecutive_losses: number;
  streak_loss_total: number;
  pity_after_losses: number;
  last_roll_won: number;
  largest_loss: number;
  last_bet_amount: number | null;
  last_loss_amount: number | null;
  last_verdict: string | null;
  updated_at: number;
};

export type DiceGameLeaderboardRow = {
  rank: number;
  torn_user_id: number;
  member_name: string | null;
  total_gained: number;
  xanax_balance: number;
  total_lost: number;
  rolls: number;
  largest_loss: number;
  last_verdict: string | null;
  updated_at: number;
};

export type DiceGameResponse = {
  ok: boolean;
  profile: DiceGameProfile;
  leaderboard: DiceGameLeaderboardRow[];
};

export type DiceGameRollResponse = DiceGameResponse & {
  result: {
    bet_amount: number;
    bet_number: number;
    is_win: boolean;
    win_amount: number;
    loss_amount: number;
    haunted_number_trap: boolean;
    haunted_original_number: number | null;
    tax_triggered: boolean;
    tax_too_poor: boolean;
    tax_percent: number;
    tax_amount: number;
    verdict: string;
    roll_faces: [number, number, number];
    double_win_blocked: boolean;
    pity_checked: boolean;
    pity_win: boolean;
    pity_required_losses: number;
    pity_streak_losses: number;
    pity_payout: number;
  };
};

export type DiceGameSendXanaxResponse = DiceGameResponse & {
  result: {
    amount: number;
    message: string;
  };
};

export type AttackExportOptions = {
  warName: string;
  scope: "all" | "outgoing" | "war_relevant";
  startWindow: "official" | "practical" | "custom";
  finishWindow: "official" | "practical" | "custom";
  linkedStatus: "linked" | "matching" | "unlinked";
  columns: "standard" | "debug";
  customStart?: number;
  customFinish?: number;
};

export type AuthUser = {
  id: number;
  name: string | null;
  key_access_level?: number | null;
  key_access_type?: string | null;
  key_faction_access?: boolean;
};

export type AuthSession = {
  ok: boolean;
  token?: string;
  access_level: "member" | "admin";
  expires_at: number;
  user: AuthUser;
};

export type MonitorTicketResponse = {
  ok: boolean;
  ticket: string;
  expires_at: number;
};

export type TradeItemSource = "weav3r_verified" | "torn";

export type TradeSnapshotSummary = {
  id: string;
  scanned_at: number;
  scanned_by_torn_user_id: number | null;
  status: string;
  error: string | null;
  opportunity_count: number;
};

export type TradeItemSnapshotSummary = {
  id: string;
  item_id: number;
  item_name: string | null;
  item_source: TradeItemSource;
  scanned_at: number;
  scanned_by_torn_user_id: number | null;
  status: string;
  error: string | null;
  offer_count: number;
};

export type TradeWatchlist = {
  id: number;
  name: string;
  item_ids: number[];
  item_source: TradeItemSource;
  min_profit: number;
  min_roi_percent: number;
  min_quantity: number;
  market_fee_percent: number;
  created_by_torn_user_id: number | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  latest_snapshot: TradeSnapshotSummary | null;
};

export type TradeOpportunity = {
  id: string;
  snapshot_id: string;
  watchlist_id: number | null;
  item_id: number;
  item_name: string | null;
  item_source?: TradeItemSource;
  source: string;
  listing_price: number;
  resale_price: number;
  profit: number;
  roi_percent: number;
  quantity: number;
  bulk_profit: number;
  needed_quantity: number | null;
  seller_id: number | null;
  seller_name: string | null;
  reference_label: string | null;
  raw_json: string | null;
  created_at: number;
};

export type TradeWatchlistPayload = {
  name?: string;
  item_ids: number[];
  item_source: TradeItemSource;
  min_profit: number;
  min_roi_percent: number;
  min_quantity: number;
  market_fee_percent: number;
};

export type TradeWatchlistsResponse = {
  ok: boolean;
  watchlists: TradeWatchlist[];
};

export type TradeWatchlistResponse = {
  ok: boolean;
  watchlist: TradeWatchlist;
};

export type TradeOpportunitiesResponse = {
  ok: boolean;
  snapshot?: TradeSnapshotSummary | null;
  snapshots?: TradeItemSnapshotSummary[];
  opportunities: TradeOpportunity[];
};

export type TradeScanResponse = {
  ok: boolean;
  snapshot?: TradeSnapshotSummary | null;
  snapshots?: TradeItemSnapshotSummary[];
  opportunities: TradeOpportunity[];
};
