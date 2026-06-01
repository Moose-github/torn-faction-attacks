-- Current D1 schema snapshot.
--
-- This is documentation only. Cloudflare D1 migration history still lives in
-- migrations/ and should remain the source of truth for applied databases.

CREATE TABLE admin_users (
  torn_user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE attacks (
    id INTEGER PRIMARY KEY,
    war_id INTEGER,
    code TEXT,
    started INTEGER,
    ended INTEGER,

    attacker_id INTEGER,
    attacker_name TEXT,
    attacker_level INTEGER,
    attacker_faction_id INTEGER,
    attacker_faction_name TEXT,

    defender_id INTEGER,
    defender_name TEXT,
    defender_level INTEGER,
    defender_faction_id INTEGER,
    defender_faction_name TEXT,

    result TEXT,
    respect_gain REAL DEFAULT 0,
    respect_loss REAL DEFAULT 0,
    chain INTEGER,

    is_interrupted INTEGER,
    is_stealthed INTEGER,
    is_raid INTEGER,
    is_ranked_war INTEGER,

    m_fair_fight REAL,
    m_war REAL,
    m_retaliation REAL,
    m_group REAL,
    m_overseas REAL,
    m_chain REAL,
    m_warlord REAL,

    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ingest_run_id TEXT,

    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  torn_user_id INTEGER NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('member', 'admin')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE dice_game_losses (
  torn_user_id INTEGER PRIMARY KEY,
  member_name TEXT,
  xanax_balance INTEGER NOT NULL DEFAULT 250,
  total_gained INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  rolls INTEGER NOT NULL DEFAULT 0,
  largest_loss INTEGER NOT NULL DEFAULT 0,
  last_bet_amount INTEGER,
  last_loss_amount INTEGER,
  last_verdict TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, consecutive_losses INTEGER NOT NULL DEFAULT 0, streak_loss_total INTEGER NOT NULL DEFAULT 0, pity_after_losses INTEGER NOT NULL DEFAULT 0, last_roll_won INTEGER NOT NULL DEFAULT 0, last_natural_win INTEGER NOT NULL DEFAULT 0);

CREATE TABLE discord_alert_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  mention_type TEXT NOT NULL CHECK (mention_type IN ('user', 'role')),
  discord_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(alert_key, mention_type, discord_id)
);

CREATE TABLE enemy_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  is_revivable INTEGER,
  ff_battlestats INTEGER,
  ff_battlestats_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, networth INTEGER, networth_updated_at INTEGER, status_state TEXT, status_description TEXT, plane_image_type TEXT, travel_origin TEXT, travel_destination TEXT, travel_signature TEXT, travel_detected_at INTEGER, travel_started_after INTEGER, travel_started_before INTEGER, estimated_arrival_at INTEGER, estimated_arrival_earliest INTEGER, estimated_arrival_latest INTEGER, status_updated_at INTEGER, bsp_battlestats INTEGER, bsp_battlestats_updated_at INTEGER, travel_trip_destination TEXT, travel_trip_type TEXT, travel_trip_inferred_at INTEGER, last_action_status TEXT, last_action_timestamp INTEGER, networth_attempted_at INTEGER, networth_attempt_count INTEGER NOT NULL DEFAULT 0, networth_error TEXT, networth_key_source TEXT);

CREATE TABLE enemy_hit_stat_snapshots (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL,
  requested_at INTEGER,
  rankedwarhits INTEGER,
  attackhits INTEGER,
  temphits INTEGER,
  piercinghits INTEGER,
  slashinghits INTEGER,
  clubbinghits INTEGER,
  mechanicalhits INTEGER,
  h2hhits INTEGER,
  retals INTEGER,
  specialammoused INTEGER,
  rankedwarhits_timestamp INTEGER,
  attackhits_timestamp INTEGER,
  temphits_timestamp INTEGER,
  piercinghits_timestamp INTEGER,
  slashinghits_timestamp INTEGER,
  clubbinghits_timestamp INTEGER,
  mechanicalhits_timestamp INTEGER,
  h2hhits_timestamp INTEGER,
  retals_timestamp INTEGER,
  specialammoused_timestamp INTEGER,
  attempted_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  key_source TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, faction_id, member_id, snapshot_date)
);

CREATE TABLE enemy_push_activity_snapshots (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  total_members INTEGER NOT NULL,
  online_count INTEGER NOT NULL,
  idle_count INTEGER NOT NULL,
  offline_count INTEGER NOT NULL,
  recently_active_count INTEGER NOT NULL,
  offline_idle_to_online_count INTEGER NOT NULL,
  enemy_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  hospital_count INTEGER NOT NULL,
  revivable_count INTEGER NOT NULL,
  baseline_active_count REAL,
  activity_above_baseline REAL,
  online_delta_10m INTEGER NOT NULL DEFAULT 0,
  recently_active_delta_10m INTEGER NOT NULL DEFAULT 0,
  pressure_score INTEGER NOT NULL DEFAULT 0,
  pressure_level TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, bucket_start)
);

CREATE TABLE faction_activity_heatmap (
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (faction_id, date, interval_index)
);

CREATE TABLE home_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  is_revivable INTEGER,
  ff_battlestats INTEGER,
  ff_battlestats_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, networth INTEGER, networth_updated_at INTEGER, bsp_battlestats INTEGER, bsp_battlestats_updated_at INTEGER, is_current INTEGER NOT NULL DEFAULT 1, report_exempt INTEGER NOT NULL DEFAULT 0, report_exempt_reason TEXT, report_exempt_updated_at INTEGER);

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ranked_war_checked_at INTEGER,
  attacks_fetch_finished_at INTEGER,
  d1_writes_finished_at INTEGER,
  stats_finished_at INTEGER,
  report_finished_at INTEGER,
  heatmap_finished_at INTEGER,
  finished_at INTEGER,
  latest_attack_started INTEGER,
  fetched_pages INTEGER NOT NULL DEFAULT 0,
  fetched_attacks INTEGER NOT NULL DEFAULT 0,
  wrote_batches INTEGER NOT NULL DEFAULT 0,
  saw_rows INTEGER NOT NULL DEFAULT 0,
  active_war_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  error TEXT
, attack_write_statements INTEGER NOT NULL DEFAULT 0, sync_state_writes INTEGER NOT NULL DEFAULT 0, stat_write_operations INTEGER NOT NULL DEFAULT 0, report_write_operations INTEGER NOT NULL DEFAULT 0);

CREATE TABLE member_achievement_summaries (
  metric_key TEXT NOT NULL,
  metric_group TEXT NOT NULL,
  metric_title TEXT NOT NULL,
  period_key TEXT NOT NULL,
  rank INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  period_start_date TEXT NOT NULL,
  period_end_date TEXT NOT NULL,
  source_snapshot_date TEXT,
  detail_json TEXT,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (metric_key, rank)
);

CREATE TABLE member_gym_stats_current (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  gym_captured_at INTEGER,
  gym_error TEXT
);

CREATE TABLE member_lifestyle_repair_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  snapshot_date TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  key_source TEXT,
  returned_bucket_date TEXT,
  error TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(job_id, member_id, snapshot_date),
  FOREIGN KEY (job_id) REFERENCES member_lifestyle_repair_jobs(id)
);

CREATE TABLE member_lifestyle_repair_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  effective_start_date TEXT NOT NULL,
  member_scope TEXT NOT NULL DEFAULT 'current',
  calls_per_minute_per_key INTEGER NOT NULL DEFAULT 35,
  include_primary_key INTEGER NOT NULL DEFAULT 1,
  active_key_count INTEGER NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  alert_sent_at INTEGER,
  last_error TEXT
, member_id INTEGER);

CREATE TABLE member_lifestyle_stat_snapshots (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  captured_at INTEGER NOT NULL, networth INTEGER, daysbeendonator INTEGER, xantaken_timestamp INTEGER, overdosed_timestamp INTEGER, refills_timestamp INTEGER, useractivity_timestamp INTEGER, networth_timestamp INTEGER, daysbeendonator_timestamp INTEGER, personalstats_bucket_date TEXT, personalstats_requested_at INTEGER, personalstats_key_source TEXT, validation_error TEXT, personal_captured_at INTEGER, gym_captured_at INTEGER, personal_ready INTEGER NOT NULL DEFAULT 0, gym_ready INTEGER NOT NULL DEFAULT 0, fully_ready INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE TABLE member_personal_stats_current (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  daysbeendonator INTEGER,
  xantaken_timestamp INTEGER,
  overdosed_timestamp INTEGER,
  refills_timestamp INTEGER,
  useractivity_timestamp INTEGER,
  networth_timestamp INTEGER,
  daysbeendonator_timestamp INTEGER,
  personalstats_bucket_date TEXT,
  personalstats_requested_at INTEGER,
  personalstats_key_source TEXT,
  personal_captured_at INTEGER,
  validation_error TEXT,
  error TEXT
);

CREATE TABLE member_personal_stats_recent (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  daysbeendonator INTEGER,
  xantaken_timestamp INTEGER,
  overdosed_timestamp INTEGER,
  refills_timestamp INTEGER,
  useractivity_timestamp INTEGER,
  networth_timestamp INTEGER,
  daysbeendonator_timestamp INTEGER,
  personalstats_bucket_date TEXT,
  target_timestamp INTEGER NOT NULL,
  attempted_at INTEGER,
  personalstats_key_source TEXT,
  personal_captured_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'retry_expired', 'failed')),
  error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE TABLE member_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  torn_user_id INTEGER NOT NULL,
  member_name TEXT,
  suggestion TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE scheduled_maintenance_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  task_count INTEGER NOT NULL DEFAULT 0,
  write_statements INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE scheduled_maintenance_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  write_statements INTEGER NOT NULL DEFAULT 0,
  changed_rows INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  error TEXT,
  FOREIGN KEY (run_id) REFERENCES scheduled_maintenance_runs(id)
);

CREATE TABLE "stock_copy_movement_events" (
  id TEXT PRIMARY KEY,
  source_player_id INTEGER NOT NULL,
  source_player_name TEXT NOT NULL,
  activity_status TEXT,
  activity_timestamp INTEGER,
  observed_at INTEGER NOT NULL,
  window_start_at INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  strength REAL NOT NULL,
  price_change REAL,
  investor_change REAL,
  share_pressure REAL,
  market_cap_change REAL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  paper_trade_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(source_player_id, observed_at, stock_id, side),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id),
  FOREIGN KEY (paper_trade_id) REFERENCES stock_paper_trades(id) ON DELETE SET NULL
);

CREATE TABLE stock_ingestion_runs (
  id TEXT PRIMARY KEY,
  batch_group TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  stocks_attempted INTEGER NOT NULL DEFAULT 0,
  stocks_succeeded INTEGER NOT NULL DEFAULT 0,
  stocks_failed INTEGER NOT NULL DEFAULT 0,
  points_seen INTEGER NOT NULL DEFAULT 0,
  points_written INTEGER NOT NULL DEFAULT 0,
  recoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  unrecoverable_gap_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  details_json TEXT
);

CREATE TABLE stock_paper_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'active',
  strategy_key TEXT NOT NULL,
  starting_cash REAL NOT NULL,
  cash_balance REAL NOT NULL,
  realized_pnl REAL NOT NULL DEFAULT 0,
  buy_fee_rate REAL NOT NULL DEFAULT 0,
  sell_fee_rate REAL NOT NULL DEFAULT 0.001,
  max_open_positions INTEGER NOT NULL DEFAULT 5,
  max_position_fraction REAL NOT NULL DEFAULT 0.25,
  min_cash_reserve_fraction REAL NOT NULL DEFAULT 0.05,
  last_decision_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE stock_paper_equity_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  simulation_run_id TEXT,
  observed_at INTEGER NOT NULL,
  cash_balance REAL NOT NULL,
  holdings_value REAL NOT NULL,
  total_equity REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  exposure_fraction REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (simulation_run_id) REFERENCES stock_paper_simulation_runs(id)
);

CREATE TABLE stock_paper_positions (
  account_id TEXT NOT NULL,
  stock_id INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  average_entry_price REAL NOT NULL,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, stock_id),
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE TABLE stock_paper_simulation_runs (
  id TEXT PRIMARY KEY,
  strategy_key TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  simulation_start_at INTEGER,
  simulation_end_at INTEGER,
  status TEXT NOT NULL,
  starting_cash REAL NOT NULL,
  final_equity REAL,
  return_percent REAL,
  max_drawdown_percent REAL,
  trade_count INTEGER NOT NULL DEFAULT 0,
  win_trade_count INTEGER NOT NULL DEFAULT 0,
  buy_fee_rate REAL NOT NULL DEFAULT 0,
  sell_fee_rate REAL NOT NULL DEFAULT 0.001,
  config_json TEXT,
  error TEXT
);

CREATE TABLE stock_paper_trades (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  simulation_run_id TEXT,
  stock_id INTEGER NOT NULL,
  side TEXT NOT NULL,
  shares INTEGER NOT NULL,
  price REAL NOT NULL,
  gross_value REAL NOT NULL,
  fee REAL NOT NULL,
  net_value REAL NOT NULL,
  realized_pnl REAL,
  executed_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  score REAL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES stock_paper_accounts(id),
  FOREIGN KEY (simulation_run_id) REFERENCES stock_paper_simulation_runs(id),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE TABLE stock_price_snapshots (
  stock_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  price REAL NOT NULL,
  raw_json TEXT,
  fetched_at INTEGER NOT NULL, market_cap INTEGER, total_shares INTEGER, investors INTEGER,
  PRIMARY KEY (stock_id, observed_at),
  FOREIGN KEY (stock_id) REFERENCES stock_profiles(stock_id)
);

CREATE TABLE stock_profiles (
  stock_id INTEGER PRIMARY KEY,
  acronym TEXT,
  name TEXT,
  current_price REAL,
  market_cap INTEGER,
  total_shares INTEGER,
  available_shares INTEGER,
  forecast TEXT,
  demand TEXT,
  benefit_json TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_state (
    name TEXT PRIMARY KEY,
    last_started INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_war_id INTEGER
);

CREATE TABLE xanax_competition_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT NOT NULL UNIQUE,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  xantaken INTEGER NOT NULL DEFAULT 0,
  prize_paid INTEGER NOT NULL,
  claimed_by_torn_user_id INTEGER,
  claimed_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE xanax_competition_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  base_prize INTEGER NOT NULL DEFAULT 10000000,
  rollover_count INTEGER NOT NULL DEFAULT 0,
  last_rollover_month_key TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE torn_api_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_at INTEGER NOT NULL,
  feature TEXT NOT NULL,
  key_source TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  retry_attempt INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE torn_shoplifting_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT,
  fetched_at INTEGER,
  error TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE trade_item_offers (
  id TEXT PRIMARY KEY,
  item_snapshot_id TEXT NOT NULL REFERENCES trade_item_snapshots(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  item_source TEXT NOT NULL,
  source TEXT NOT NULL,
  listing_price INTEGER NOT NULL,
  reference_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fee_applies INTEGER NOT NULL DEFAULT 1,
  seller_id INTEGER,
  seller_name TEXT,
  reference_label TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE trade_item_snapshots (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  item_source TEXT NOT NULL,
  item_name TEXT,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  raw_json TEXT
);

CREATE TABLE trade_opportunities (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES trade_watchlist_snapshots(id) ON DELETE CASCADE,
  watchlist_id INTEGER NOT NULL REFERENCES trade_watchlists(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL,
  item_name TEXT,
  source TEXT NOT NULL,
  listing_price INTEGER NOT NULL,
  resale_price INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  roi_percent REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  bulk_profit INTEGER NOT NULL DEFAULT 0,
  needed_quantity INTEGER,
  seller_id INTEGER,
  seller_name TEXT,
  reference_label TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE trade_watchlist_snapshots (
  id TEXT PRIMARY KEY,
  watchlist_id INTEGER NOT NULL REFERENCES trade_watchlists(id) ON DELETE CASCADE,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  settings_json TEXT NOT NULL
);

CREATE TABLE trade_watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  item_ids_json TEXT NOT NULL,
  item_source TEXT NOT NULL DEFAULT 'weav3r_verified',
  min_profit INTEGER NOT NULL DEFAULT 25000,
  min_roi_percent REAL NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 1,
  market_fee_percent REAL NOT NULL DEFAULT 5,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
, created_by_torn_user_id INTEGER, created_by_name TEXT);

CREATE TABLE war_member_activity_buckets (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,

  attacks_successful INTEGER NOT NULL DEFAULT 0,
  outside_hits INTEGER NOT NULL DEFAULT 0,
  defends_lost INTEGER NOT NULL DEFAULT 0,

  respect_gained REAL NOT NULL DEFAULT 0,
  respect_lost REAL NOT NULL DEFAULT 0,

  PRIMARY KEY (war_id, member_id, bucket_start),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE war_member_stats (
    war_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    member_name TEXT,

    attacks_vs_enemy_total INTEGER NOT NULL DEFAULT 0,
    attacks_vs_enemy_successful INTEGER NOT NULL DEFAULT 0,
    respect_gained REAL NOT NULL DEFAULT 0,

    assists_vs_enemy INTEGER NOT NULL DEFAULT 0,
    hospitalizations_vs_enemy INTEGER NOT NULL DEFAULT 0,
    mugs_vs_enemy INTEGER NOT NULL DEFAULT 0,

    outside_hits INTEGER NOT NULL DEFAULT 0,
    friendly_hosps INTEGER NOT NULL DEFAULT 0,

    defends_total INTEGER NOT NULL DEFAULT 0,
    defends_won INTEGER NOT NULL DEFAULT 0,
    respect_lost REAL NOT NULL DEFAULT 0,

    first_action_at INTEGER,
    last_action_at INTEGER, added_from_report INTEGER NOT NULL DEFAULT 0, retaliations_vs_enemy INTEGER NOT NULL DEFAULT 0, respect_gained_raw REAL NOT NULL DEFAULT 0, average_fair_fight REAL, defends_other INTEGER NOT NULL DEFAULT 0, respect_lost_raw REAL NOT NULL DEFAULT 0, chain_bonus_hits_vs_enemy INTEGER NOT NULL DEFAULT 0, chain_bonus_respect_removed REAL NOT NULL DEFAULT 0, enemy_chain_bonus_hits_received INTEGER NOT NULL DEFAULT 0, enemy_chain_bonus_respect_removed REAL NOT NULL DEFAULT 0, chain_bonus_hit_values_vs_enemy TEXT NOT NULL DEFAULT '', enemy_chain_bonus_hit_values_received TEXT NOT NULL DEFAULT '', chain_bonus_hit_details_vs_enemy TEXT NOT NULL DEFAULT '', enemy_chain_bonus_hit_details_received TEXT NOT NULL DEFAULT '', defends_lost_non_hospitalized INTEGER NOT NULL DEFAULT 0, respect_lost_non_hospitalized REAL NOT NULL DEFAULT 0,

    PRIMARY KEY (war_id, member_id),
    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE war_summary (
    war_id INTEGER PRIMARY KEY,
    attacks_vs_enemy_total INTEGER NOT NULL DEFAULT 0,
    total_respect_gain REAL NOT NULL DEFAULT 0,
    total_respect_lost REAL NOT NULL DEFAULT 0,

    unique_attackers INTEGER NOT NULL DEFAULT 0,
    first_attack_at INTEGER,
    last_attack_at INTEGER,

    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    attacks_from_enemy_total INTEGER NOT NULL DEFAULT 0,
    outside_hits INTEGER NOT NULL DEFAULT 0, total_respect_gain_raw REAL NOT NULL DEFAULT 0, total_respect_lost_raw REAL NOT NULL DEFAULT 0,

    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE wars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'ended')),
    practical_start_time INTEGER NOT NULL,
    practical_finish_time INTEGER,
    finalized_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    enemy_faction_id INTEGER,
    war_type TEXT
, torn_war_id INTEGER, auto_end_enabled INTEGER NOT NULL DEFAULT 0, faction_respect_limit REAL, member_respect_limit REAL, winner_faction_id INTEGER, torn_report_fetched_at INTEGER, official_home_score REAL, official_home_attacks INTEGER, official_enemy_score REAL, official_enemy_attacks INTEGER, official_end_time INTEGER, official_start_time INTEGER, enemy_scouting_auto_attempted_at INTEGER, enemy_scouting_status_checked_at INTEGER);

CREATE INDEX idx_attacks_attacker_faction_started
ON attacks(attacker_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_attacker_faction_war
    ON attacks(attacker_faction_id, war_id, started DESC);

CREATE INDEX idx_attacks_defender_faction_started
ON attacks(defender_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_defender_faction_war
    ON attacks(defender_faction_id, war_id, started DESC);

CREATE INDEX idx_attacks_ingest_run_war_attacker
ON attacks(ingest_run_id, war_id, attacker_faction_id, attacker_id);

CREATE INDEX idx_attacks_ingest_run_war_defender
ON attacks(ingest_run_id, war_id, defender_faction_id, defender_id);

CREATE INDEX idx_attacks_started
    ON attacks(started DESC);

CREATE INDEX idx_attacks_war_attacker_started
ON attacks (war_id, attacker_id, started DESC);

CREATE INDEX idx_attacks_war_defender_started
ON attacks (war_id, defender_id, started DESC);

CREATE INDEX idx_attacks_war_ingest_run
  ON attacks(war_id, ingest_run_id);

CREATE INDEX idx_attacks_war_started
    ON attacks(war_id, started DESC);

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);

CREATE INDEX idx_dice_game_losses_total_lost
  ON dice_game_losses(total_lost DESC, rolls DESC);

CREATE INDEX idx_discord_alert_mentions_alert
  ON discord_alert_mentions (alert_key, enabled);

CREATE INDEX idx_enemy_faction_members_faction
  ON enemy_faction_members(faction_id);

CREATE INDEX idx_enemy_faction_members_ranked
  ON enemy_faction_members(faction_id, ff_battlestats DESC, level DESC, name);

CREATE INDEX idx_enemy_faction_members_pending_networth
  ON enemy_faction_members(faction_id, networth_updated_at, networth_attempt_count, networth_attempted_at, level DESC, name)
  WHERE networth_updated_at IS NULL;

CREATE INDEX idx_enemy_hit_stat_snapshots_pending
  ON enemy_hit_stat_snapshots(war_id, faction_id, completed_at, attempt_count, attempted_at, snapshot_kind, snapshot_date, member_name)
  WHERE completed_at IS NULL;

CREATE INDEX idx_enemy_hit_stat_snapshots_member
  ON enemy_hit_stat_snapshots(war_id, faction_id, member_id, snapshot_date);

CREATE INDEX idx_faction_activity_heatmap_faction_sampled
  ON faction_activity_heatmap(faction_id, sampled_at);

CREATE INDEX idx_faction_activity_heatmap_sampled
  ON faction_activity_heatmap(sampled_at);

CREATE INDEX idx_home_faction_members_current
  ON home_faction_members(is_current, member_id);

CREATE INDEX idx_home_faction_members_faction
  ON home_faction_members(faction_id);

CREATE INDEX idx_home_faction_members_ranked
  ON home_faction_members(faction_id, ff_battlestats DESC, level DESC, name);

CREATE INDEX idx_home_faction_members_reportable
  ON home_faction_members(faction_id, is_current, report_exempt, member_id);

CREATE INDEX idx_ingestion_runs_started
  ON ingestion_runs(started_at DESC);

CREATE INDEX idx_member_achievement_computed
  ON member_achievement_summaries(computed_at DESC);

CREATE INDEX idx_member_achievement_group
  ON member_achievement_summaries(metric_group, metric_key, rank);

CREATE INDEX idx_member_gym_stats_current_captured
  ON member_gym_stats_current(gym_captured_at);

CREATE INDEX idx_member_lifestyle_repair_items_job_status
  ON member_lifestyle_repair_items(job_id, status, snapshot_date, member_id);

CREATE INDEX idx_member_lifestyle_repair_items_status
  ON member_lifestyle_repair_items(status, updated_at);

CREATE INDEX idx_member_lifestyle_repair_jobs_status
  ON member_lifestyle_repair_jobs(status, updated_at);

CREATE INDEX idx_member_lifestyle_snapshots_bucket_date
  ON member_lifestyle_stat_snapshots(personalstats_bucket_date);

CREATE INDEX idx_member_lifestyle_snapshots_date
  ON member_lifestyle_stat_snapshots(snapshot_date);

CREATE INDEX idx_member_lifestyle_snapshots_fully_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, fully_ready);

CREATE INDEX idx_member_lifestyle_snapshots_gym_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, gym_ready);

CREATE INDEX idx_member_lifestyle_snapshots_personal_ready
  ON member_lifestyle_stat_snapshots(snapshot_date, personal_ready);

CREATE INDEX idx_member_personal_stats_current_bucket
  ON member_personal_stats_current(personalstats_bucket_date);

CREATE INDEX idx_member_personal_stats_current_captured
  ON member_personal_stats_current(personal_captured_at);

CREATE INDEX idx_member_personal_stats_recent_status
  ON member_personal_stats_recent(status, snapshot_date, attempted_at, member_name);

CREATE INDEX idx_member_personal_stats_recent_captured
  ON member_personal_stats_recent(snapshot_date, personal_captured_at);

CREATE INDEX idx_member_stats_respect_sort
  ON war_member_stats(war_id, respect_gained DESC, attacks_vs_enemy_successful DESC, attacks_vs_enemy_total DESC);

CREATE INDEX idx_member_suggestions_created
ON member_suggestions(created_at DESC, id DESC);

CREATE INDEX idx_scheduled_maintenance_runs_started
  ON scheduled_maintenance_runs(started_at DESC);

CREATE INDEX idx_scheduled_maintenance_tasks_run
  ON scheduled_maintenance_tasks(run_id);

CREATE INDEX idx_stock_copy_movement_events_status_time
  ON stock_copy_movement_events(status, observed_at DESC);

CREATE INDEX idx_stock_ingestion_runs_started
  ON stock_ingestion_runs(started_at DESC);

CREATE INDEX idx_stock_paper_accounts_mode_status
  ON stock_paper_accounts(mode, status);

CREATE INDEX idx_stock_paper_equity_account_time
  ON stock_paper_equity_snapshots(account_id, observed_at DESC);

CREATE INDEX idx_stock_paper_equity_simulation_time
  ON stock_paper_equity_snapshots(simulation_run_id, observed_at DESC);

CREATE INDEX idx_stock_paper_simulation_runs_started
  ON stock_paper_simulation_runs(started_at DESC);

CREATE INDEX idx_stock_paper_trades_account_time
  ON stock_paper_trades(account_id, executed_at DESC);

CREATE INDEX idx_stock_paper_trades_simulation_time
  ON stock_paper_trades(simulation_run_id, executed_at DESC);

CREATE INDEX idx_stock_price_snapshots_observed_stock
  ON stock_price_snapshots(observed_at ASC, stock_id ASC);

CREATE INDEX idx_stock_profiles_updated
  ON stock_profiles(updated_at DESC);

CREATE INDEX idx_torn_api_call_log_feature_requested_at
  ON torn_api_call_log(feature, requested_at DESC);

CREATE INDEX idx_torn_api_call_log_requested_at
  ON torn_api_call_log(requested_at DESC);

CREATE INDEX idx_torn_api_call_log_status_requested_at
  ON torn_api_call_log(status, requested_at DESC);

CREATE INDEX idx_trade_item_offers_snapshot
  ON trade_item_offers(item_snapshot_id);

CREATE INDEX idx_trade_item_snapshots_latest
  ON trade_item_snapshots(item_id, item_source, scanned_at DESC);

CREATE INDEX idx_trade_opportunities_snapshot_profit
  ON trade_opportunities(snapshot_id, profit DESC);

CREATE INDEX idx_trade_opportunities_watchlist_created
  ON trade_opportunities(watchlist_id, created_at DESC);

CREATE INDEX idx_trade_snapshots_watchlist_scanned
  ON trade_watchlist_snapshots(watchlist_id, scanned_at DESC);

CREATE INDEX idx_trade_watchlists_created_by
  ON trade_watchlists(created_by_torn_user_id, updated_at DESC);

CREATE INDEX idx_trade_watchlists_updated_at
  ON trade_watchlists(updated_at DESC);

CREATE INDEX idx_war_member_activity_buckets_war_bucket
  ON war_member_activity_buckets(war_id, bucket_start);

CREATE INDEX idx_wars_lower_name
  ON wars(LOWER(name));

CREATE INDEX idx_wars_status_practical_start
  ON wars(status, practical_start_time DESC);

CREATE UNIQUE INDEX idx_wars_torn_war_id_unique
  ON wars(torn_war_id)
  WHERE torn_war_id IS NOT NULL;

CREATE INDEX idx_wars_war_type
    ON wars(war_type);

CREATE INDEX idx_xanax_competition_claims_claimed
  ON xanax_competition_claims(claimed_at DESC);
