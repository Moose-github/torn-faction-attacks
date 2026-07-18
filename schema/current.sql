-- Canonical current D1 schema snapshot.
--
-- Keep this file updated when adding migrations so the clean current-state
-- schema is easy to review. Do not apply this file to existing databases:
-- Cloudflare D1 migration history lives in migrations/ and remains the source
-- of truth for deployed databases.

CREATE TABLE admin_users (
  torn_user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE alert_settings (
  alert_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  configurable INTEGER NOT NULL DEFAULT 1 CHECK (configurable IN (0, 1)),
  scope TEXT NOT NULL DEFAULT 'global',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
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

CREATE TABLE retaliation_claim_signals (
  opening_attack_id INTEGER PRIMARY KEY,
  target_id INTEGER NOT NULL,
  claimant_torn_user_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('dashboard', 'tampermonkey')),
  attack_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE retaliation_opportunities (
  target_id INTEGER PRIMARY KEY,
  opening_attack_id INTEGER NOT NULL,
  attack_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  code TEXT,
  started INTEGER,
  ended INTEGER NOT NULL,
  attacker_id INTEGER NOT NULL,
  attacker_name TEXT,
  attacker_faction_id INTEGER,
  attacker_faction_name TEXT,
  defender_id INTEGER,
  defender_name TEXT,
  defender_faction_id INTEGER,
  defender_faction_name TEXT,
  result TEXT NOT NULL,
  respect_gain REAL DEFAULT 0,
  respect_loss REAL DEFAULT 0,
  m_retaliation REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE retaliation_board_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  discord_message_id TEXT,
  discord_target_id TEXT,
  last_rendered_hash TEXT,
  last_edited_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE chain_watch_state (
  war_id INTEGER PRIMARY KEY REFERENCES wars(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'stored',
  current_chain INTEGER,
  reset_at INTEGER,
  timeout_at INTEGER,
  last_hit_id INTEGER,
  last_hit_at INTEGER,
  last_hit_attacker_name TEXT,
  last_hit_defender_name TEXT,
  last_hit_result TEXT,
  scheduled_alarm_stage TEXT,
  scheduled_alarm_at INTEGER,
  warning_60_sent_at INTEGER,
  warning_30_sent_at INTEGER,
  drop_sent_at INTEGER,
  alert_chain INTEGER,
  alert_reset_at INTEGER,
  discord_message_id TEXT,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_chain_watch_state_enabled
  ON chain_watch_state (enabled, timeout_at);

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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  streak_loss_total INTEGER NOT NULL DEFAULT 0,
  pity_after_losses INTEGER NOT NULL DEFAULT 0,
  last_roll_won INTEGER NOT NULL DEFAULT 0,
  last_natural_win INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE data_health_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ingestion_warn_seconds INTEGER NOT NULL DEFAULT 600,
  ingestion_critical_seconds INTEGER NOT NULL DEFAULT 1800,
  maintenance_warn_seconds INTEGER NOT NULL DEFAULT 2700,
  maintenance_critical_seconds INTEGER NOT NULL DEFAULT 7200,
  daily_stats_lag_warn_days INTEGER NOT NULL DEFAULT 1,
  daily_stats_lag_critical_days INTEGER NOT NULL DEFAULT 2,
  stale_daily_members_warn INTEGER NOT NULL DEFAULT 1,
  stale_daily_members_critical INTEGER NOT NULL DEFAULT 5,
  api_error_rate_warn_percent REAL NOT NULL DEFAULT 5,
  api_error_rate_critical_percent REAL NOT NULL DEFAULT 15,
  api_rate_limited_warn INTEGER NOT NULL DEFAULT 1,
  api_rate_limited_critical INTEGER NOT NULL DEFAULT 5,
  stock_freshness_warn_seconds INTEGER NOT NULL DEFAULT 300,
  stock_freshness_critical_seconds INTEGER NOT NULL DEFAULT 1800,
  stale_stocks_warn INTEGER NOT NULL DEFAULT 1,
  stale_stocks_critical INTEGER NOT NULL DEFAULT 5,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE discord_admin_alert_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  subscription_type TEXT NOT NULL CHECK (subscription_type IN ('user', 'role')),
  discord_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(alert_key, subscription_type, discord_id)
);

CREATE TABLE discord_travel_tracker_state (
  tracker_key TEXT PRIMARY KEY CHECK (tracker_key IN ('target', 'home')),
  enabled INTEGER NOT NULL DEFAULT 1,
  war_id INTEGER,
  target_source TEXT,
  faction_id INTEGER,
  destination_key TEXT,
  message_id TEXT,
  content_hash TEXT,
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE discord_travel_tracker_target (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  faction_id INTEGER NOT NULL,
  faction_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_refreshed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE enemy_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  ff_battlestats INTEGER,
  ff_battlestats_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  networth INTEGER,
  networth_updated_at INTEGER,
  bsp_battlestats INTEGER,
  bsp_battlestats_updated_at INTEGER,
  networth_attempted_at INTEGER,
  networth_attempt_count INTEGER NOT NULL DEFAULT 0,
  networth_error TEXT,
  networth_key_source TEXT
);

CREATE TABLE enemy_big_hitters (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, member_id)
);

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

CREATE TABLE enemy_member_activity_samples (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  is_recently_active INTEGER NOT NULL DEFAULT 0,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, faction_id, member_id, date, interval_index)
);

CREATE TABLE enemy_member_live_status (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  is_revivable INTEGER,
  status_state TEXT,
  status_description TEXT,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  plane_image_type TEXT,
  travel_origin TEXT,
  travel_destination TEXT,
  travel_signature TEXT,
  travel_detected_at INTEGER,
  travel_started_after INTEGER,
  travel_started_before INTEGER,
  estimated_arrival_at INTEGER,
  estimated_arrival_earliest INTEGER,
  estimated_arrival_latest INTEGER,
  travel_trip_destination TEXT,
  travel_trip_type TEXT,
  travel_trip_inferred_at INTEGER,
  status_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
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
  big_hitter_total_count INTEGER NOT NULL DEFAULT 0,
  big_hitter_online_count INTEGER NOT NULL DEFAULT 0,
  big_hitter_recently_active_count INTEGER NOT NULL DEFAULT 0,
  big_hitter_pressure_multiplier REAL NOT NULL DEFAULT 1,
  base_pressure_score INTEGER NOT NULL DEFAULT 0,
  pressure_score INTEGER NOT NULL DEFAULT 0,
  pressure_level TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, bucket_start)
);

CREATE TABLE war_control_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  control_hospital_threshold REAL NOT NULL DEFAULT 0.8,
  available_advantage_min REAL NOT NULL DEFAULT 0.15,
  opening_grace_minutes INTEGER NOT NULL DEFAULT 15,
  min_observed_roster_percent REAL NOT NULL DEFAULT 0.6,
  min_local_relevant_members INTEGER NOT NULL DEFAULT 10,
  heavy_own_hospital_penalty_threshold REAL NOT NULL DEFAULT 0.6,
  severe_own_hospital_penalty_threshold REAL NOT NULL DEFAULT 0.75,
  heavy_own_hospital_confidence_penalty REAL NOT NULL DEFAULT 0.1,
  severe_own_hospital_confidence_penalty REAL NOT NULL DEFAULT 0.2,
  transition_hospital_ratio_drop REAL NOT NULL DEFAULT 0.2,
  transition_window_minutes INTEGER NOT NULL DEFAULT 5,
  transition_min_attacks_5m INTEGER NOT NULL DEFAULT 3,
  transition_big_hitter_multiplier_one REAL NOT NULL DEFAULT 1.1,
  transition_big_hitter_multiplier_multiple REAL NOT NULL DEFAULT 1.25,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE war_control_snapshots (
  war_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  home_total_members INTEGER NOT NULL DEFAULT 0,
  home_observed_members INTEGER NOT NULL DEFAULT 0,
  home_observed_roster_percent REAL NOT NULL DEFAULT 0,
  home_available_count INTEGER NOT NULL DEFAULT 0,
  home_hospital_count INTEGER NOT NULL DEFAULT 0,
  home_travel_count INTEGER NOT NULL DEFAULT 0,
  home_unknown_count INTEGER NOT NULL DEFAULT 0,
  home_local_relevant_count INTEGER NOT NULL DEFAULT 0,
  enemy_total_members INTEGER NOT NULL DEFAULT 0,
  enemy_observed_members INTEGER NOT NULL DEFAULT 0,
  enemy_observed_roster_percent REAL NOT NULL DEFAULT 0,
  enemy_available_count INTEGER NOT NULL DEFAULT 0,
  enemy_hospital_count INTEGER NOT NULL DEFAULT 0,
  enemy_travel_count INTEGER NOT NULL DEFAULT 0,
  enemy_unknown_count INTEGER NOT NULL DEFAULT 0,
  enemy_local_relevant_count INTEGER NOT NULL DEFAULT 0,
  home_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  enemy_attacks_last_5m INTEGER NOT NULL DEFAULT 0,
  home_attacks_last_15m INTEGER NOT NULL DEFAULT 0,
  enemy_attacks_last_15m INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_total_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_available_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_hospital_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_travel_count INTEGER NOT NULL DEFAULT 0,
  enemy_big_hitter_recently_active_count INTEGER NOT NULL DEFAULT 0,
  home_hospital_ratio REAL NOT NULL DEFAULT 0,
  enemy_hospital_ratio REAL NOT NULL DEFAULT 0,
  home_available_ratio REAL NOT NULL DEFAULT 0,
  enemy_available_ratio REAL NOT NULL DEFAULT 0,
  control_state TEXT NOT NULL,
  control_confidence REAL NOT NULL DEFAULT 0,
  control_reason TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (war_id, bucket_start),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE home_faction_activity_samples (
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (faction_id, date, interval_index)
);

CREATE TABLE enemy_faction_activity_samples (
  war_id INTEGER NOT NULL,
  faction_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  total_count INTEGER NOT NULL,
  sampled_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, faction_id, date, interval_index)
);

CREATE TABLE home_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  ff_battlestats INTEGER,
  ff_battlestats_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  networth INTEGER,
  networth_updated_at INTEGER,
  bsp_battlestats INTEGER,
  bsp_battlestats_updated_at INTEGER,
  is_current INTEGER NOT NULL DEFAULT 1,
  report_exempt INTEGER NOT NULL DEFAULT 0,
  report_exempt_reason TEXT,
  report_exempt_updated_at INTEGER
);

CREATE TABLE home_member_live_status (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  is_revivable INTEGER,
  status_state TEXT,
  status_description TEXT,
  last_action_status TEXT,
  last_action_timestamp INTEGER,
  plane_image_type TEXT,
  travel_origin TEXT,
  travel_destination TEXT,
  travel_signature TEXT,
  travel_detected_at INTEGER,
  travel_started_after INTEGER,
  travel_started_before INTEGER,
  estimated_arrival_at INTEGER,
  estimated_arrival_earliest INTEGER,
  estimated_arrival_latest INTEGER,
  travel_trip_destination TEXT,
  travel_trip_type TEXT,
  travel_trip_inferred_at INTEGER,
  status_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
  error TEXT,
  attack_write_statements INTEGER NOT NULL DEFAULT 0,
  sync_state_writes INTEGER NOT NULL DEFAULT 0,
  stat_write_operations INTEGER NOT NULL DEFAULT 0,
  report_write_operations INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE discord_member_links (
  torn_user_id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE
);

CREATE TABLE discord_member_alert_subscriptions (
  torn_user_id INTEGER NOT NULL,
  alert_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (torn_user_id, alert_key)
);

CREATE TABLE discord_notification_channels (
  guild_id TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by_discord_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (guild_id, alert_key)
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
  last_error TEXT,
  member_id INTEGER
);

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
  captured_at INTEGER NOT NULL,
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
  validation_error TEXT,
  personal_captured_at INTEGER,
  gym_captured_at INTEGER,
  personal_ready INTEGER NOT NULL DEFAULT 0,
  gym_ready INTEGER NOT NULL DEFAULT 0,
  fully_ready INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, snapshot_date)
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
  fetched_at INTEGER NOT NULL,
  market_cap INTEGER,
  total_shares INTEGER,
  investors INTEGER,
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

CREATE TABLE stock_benefit_value_overrides (
  torn_user_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  override_value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, benefit_key)
);

CREATE TABLE stock_benefit_disabled_stocks (
  torn_user_id INTEGER NOT NULL,
  stock_id INTEGER NOT NULL,
  benefit_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (torn_user_id, stock_id)
);

CREATE TABLE stock_benefit_item_prices (
  benefit_key TEXT PRIMARY KEY,
  market_type TEXT NOT NULL DEFAULT 'itemmarket',
  torn_item_id INTEGER,
  item_name TEXT,
  market_value REAL,
  fetched_at INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sync_state (
  name TEXT PRIMARY KEY,
  last_started INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_war_id INTEGER,
  war_state TEXT NOT NULL DEFAULT 'none'
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

CREATE TABLE torn_api_usage_rollup_15m (
  bucket_start INTEGER NOT NULL,
  group_type TEXT NOT NULL CHECK (group_type IN ('feature', 'endpoint', 'key_source')),
  group_value TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  max_duration_ms INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bucket_start, group_type, group_value)
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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by_torn_user_id INTEGER,
  created_by_name TEXT
);

CREATE TABLE war_member_combat_buckets (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,

  attacks_successful INTEGER NOT NULL DEFAULT 0,
  assists_vs_enemy INTEGER NOT NULL DEFAULT 0,
  outside_hits INTEGER NOT NULL DEFAULT 0,
  defends_lost INTEGER NOT NULL DEFAULT 0,
  defends_won INTEGER NOT NULL DEFAULT 0,
  defends_other INTEGER NOT NULL DEFAULT 0,

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
  last_action_at INTEGER,
  added_from_report INTEGER NOT NULL DEFAULT 0,
  retaliations_vs_enemy INTEGER NOT NULL DEFAULT 0,
  respect_gained_raw REAL NOT NULL DEFAULT 0,
  average_fair_fight REAL,
  defends_other INTEGER NOT NULL DEFAULT 0,
  respect_lost_raw REAL NOT NULL DEFAULT 0,
  chain_bonus_hits_vs_enemy INTEGER NOT NULL DEFAULT 0,
  chain_bonus_respect_removed REAL NOT NULL DEFAULT 0,
  enemy_chain_bonus_hits_received INTEGER NOT NULL DEFAULT 0,
  enemy_chain_bonus_respect_removed REAL NOT NULL DEFAULT 0,
  chain_bonus_hit_values_vs_enemy TEXT NOT NULL DEFAULT '',
  enemy_chain_bonus_hit_values_received TEXT NOT NULL DEFAULT '',
  chain_bonus_hit_details_vs_enemy TEXT NOT NULL DEFAULT '',
  enemy_chain_bonus_hit_details_received TEXT NOT NULL DEFAULT '',
  defends_lost_non_hospitalized INTEGER NOT NULL DEFAULT 0,
  respect_lost_non_hospitalized REAL NOT NULL DEFAULT 0,

  PRIMARY KEY (war_id, member_id),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE war_report_attack_reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  war_id INTEGER NOT NULL,
  torn_report_fetched_at INTEGER,
  official_start_time INTEGER NOT NULL,
  official_end_time INTEGER NOT NULL,
  member_ids_json TEXT NOT NULL,
  logic_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  torn_attacks_fetched INTEGER NOT NULL DEFAULT 0,
  comparable_torn_attacks INTEGER NOT NULL DEFAULT 0,
  local_attacks_checked INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE war_report_attack_reconciliation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES war_report_attack_reconciliation_runs(id) ON DELETE CASCADE,
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  attack_id INTEGER,
  attack_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('torn', 'local', 'both')),
  classification TEXT NOT NULL,
  reason TEXT NOT NULL,
  started INTEGER,
  ended INTEGER,
  attacker_id INTEGER,
  attacker_name TEXT,
  defender_id INTEGER,
  defender_name TEXT,
  defender_faction_id INTEGER,
  defender_faction_name TEXT,
  result TEXT,
  respect_gain REAL,
  chain INTEGER,
  local_war_id INTEGER,
  local_included INTEGER CHECK (local_included IN (0, 1)),
  torn_included INTEGER CHECK (torn_included IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
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
  outside_hits INTEGER NOT NULL DEFAULT 0,
  total_respect_gain_raw REAL NOT NULL DEFAULT 0,
  total_respect_lost_raw REAL NOT NULL DEFAULT 0,

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
  war_type TEXT,
  torn_war_id INTEGER,
  auto_end_enabled INTEGER NOT NULL DEFAULT 0,
  faction_respect_limit REAL,
  member_respect_limit REAL,
  winner_faction_id INTEGER,
  torn_report_fetched_at INTEGER,
  official_home_score REAL,
  official_home_attacks INTEGER,
  official_enemy_score REAL,
  official_enemy_attacks INTEGER,
  official_end_time INTEGER,
  official_start_time INTEGER,
  enemy_scouting_auto_attempted_at INTEGER,
  enemy_scouting_status_checked_at INTEGER
);

CREATE INDEX idx_attacks_attacker_faction_started
  ON attacks(attacker_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_attacker_faction_war
  ON attacks(attacker_faction_id, war_id, started DESC);

CREATE INDEX idx_attacks_defender_faction_started
  ON attacks(defender_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_retaliation_enemy_recent
  ON attacks(attacker_id, defender_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_retaliation_claim_recent
  ON attacks(defender_id, attacker_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_retaliation_enemy_list
  ON attacks(defender_faction_id, started DESC, id DESC);

CREATE INDEX idx_attacks_retaliation_claim_lookup
  ON attacks(defender_id, attacker_faction_id, started DESC, id DESC);

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

CREATE INDEX idx_report_attack_recon_items_run
  ON war_report_attack_reconciliation_items(run_id, member_id, classification);

CREATE INDEX idx_report_attack_recon_runs_report
  ON war_report_attack_reconciliation_runs(war_id, torn_report_fetched_at);

CREATE INDEX idx_report_attack_recon_runs_war
  ON war_report_attack_reconciliation_runs(war_id, created_at DESC);

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);

CREATE INDEX idx_retaliation_claim_signals_expires
  ON retaliation_claim_signals(expires_at);

CREATE INDEX idx_retaliation_claim_signals_target
  ON retaliation_claim_signals(target_id, updated_at DESC);

CREATE UNIQUE INDEX idx_retaliation_opportunities_opening_attack
  ON retaliation_opportunities(opening_attack_id);

CREATE INDEX idx_retaliation_opportunities_attack_at
  ON retaliation_opportunities(attack_at DESC, opening_attack_id DESC);

CREATE INDEX idx_retaliation_opportunities_expires
  ON retaliation_opportunities(expires_at);

CREATE INDEX idx_dice_game_losses_total_lost
  ON dice_game_losses(total_lost DESC, rolls DESC);

CREATE INDEX idx_discord_admin_alert_subscriptions_alert
  ON discord_admin_alert_subscriptions (alert_key, enabled);
CREATE INDEX idx_discord_member_alert_subscriptions_alert
  ON discord_member_alert_subscriptions (alert_key, enabled);
CREATE INDEX idx_discord_notification_channels_alert
  ON discord_notification_channels (alert_key, enabled);

CREATE INDEX idx_enemy_faction_members_faction
  ON enemy_faction_members(faction_id);

CREATE INDEX idx_enemy_faction_members_ranked
  ON enemy_faction_members(faction_id, ff_battlestats DESC, level DESC, name);

CREATE INDEX idx_enemy_faction_members_pending_networth
  ON enemy_faction_members(faction_id, networth_updated_at, networth_attempt_count, networth_attempted_at, level DESC, name)
  WHERE networth_updated_at IS NULL;

CREATE INDEX idx_enemy_big_hitters_faction
  ON enemy_big_hitters(faction_id, member_name);

CREATE INDEX idx_enemy_hit_stat_snapshots_pending
  ON enemy_hit_stat_snapshots(war_id, faction_id, completed_at, attempt_count, attempted_at, snapshot_kind, snapshot_date, member_name)
  WHERE completed_at IS NULL;

CREATE INDEX idx_enemy_hit_stat_snapshots_member
  ON enemy_hit_stat_snapshots(war_id, faction_id, member_id, snapshot_date);

CREATE INDEX idx_war_control_snapshots_war_created
  ON war_control_snapshots(war_id, created_at DESC);

CREATE INDEX idx_enemy_member_activity_samples_war_bucket
  ON enemy_member_activity_samples(war_id, date, interval_index);

CREATE INDEX idx_enemy_member_activity_samples_war_member
  ON enemy_member_activity_samples(war_id, member_id, date, interval_index);

CREATE INDEX idx_enemy_member_live_status_faction
  ON enemy_member_live_status(faction_id);

CREATE INDEX idx_enemy_member_live_status_state
  ON enemy_member_live_status(status_state);

CREATE INDEX idx_enemy_member_live_status_travel
  ON enemy_member_live_status(status_state, estimated_arrival_at);

CREATE INDEX idx_home_faction_activity_samples_faction_sampled
  ON home_faction_activity_samples(faction_id, sampled_at);

CREATE INDEX idx_home_faction_activity_samples_sampled
  ON home_faction_activity_samples(sampled_at);

CREATE INDEX idx_enemy_faction_activity_samples_war_bucket
  ON enemy_faction_activity_samples(war_id, date, interval_index);

CREATE INDEX idx_enemy_faction_activity_samples_faction_sampled
  ON enemy_faction_activity_samples(faction_id, sampled_at);

CREATE INDEX idx_home_faction_members_current
  ON home_faction_members(is_current, member_id);

CREATE INDEX idx_home_faction_members_faction
  ON home_faction_members(faction_id);

CREATE INDEX idx_home_faction_members_ranked
  ON home_faction_members(faction_id, ff_battlestats DESC, level DESC, name);

CREATE INDEX idx_home_faction_members_reportable
  ON home_faction_members(faction_id, is_current, report_exempt, member_id);

CREATE INDEX idx_home_member_live_status_faction
  ON home_member_live_status(faction_id);

CREATE INDEX idx_home_member_live_status_state
  ON home_member_live_status(status_state);

CREATE INDEX idx_home_member_live_status_travel
  ON home_member_live_status(status_state, estimated_arrival_at);

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

CREATE INDEX idx_torn_api_usage_rollup_type_bucket
  ON torn_api_usage_rollup_15m(group_type, bucket_start DESC);

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

CREATE INDEX idx_war_member_combat_buckets_war_bucket
  ON war_member_combat_buckets(war_id, bucket_start);

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

CREATE TABLE arrest_scout_snapshots (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_faction_id INTEGER,
  scanned_by_torn_user_id INTEGER,
  scanned_at INTEGER NOT NULL,
  lookback_seconds INTEGER NOT NULL,
  min_counterfeiting_delta INTEGER NOT NULL,
  min_fraud_delta INTEGER NOT NULL DEFAULT 500,
  status TEXT NOT NULL,
  error TEXT,
  settings_json TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  checked_count INTEGER NOT NULL DEFAULT 0,
  skill_100_count INTEGER NOT NULL DEFAULT 0,
  current_target_count INTEGER NOT NULL DEFAULT 0,
  future_target_count INTEGER NOT NULL DEFAULT 0,
  inactive_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE arrest_scout_results (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES arrest_scout_snapshots(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL,
  name TEXT,
  classification TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  current_forgeryskill INTEGER,
  current_counterfeiting INTEGER,
  historical_counterfeiting INTEGER,
  counterfeiting_delta INTEGER,
  current_scammingskill INTEGER,
  current_fraud INTEGER,
  historical_fraud INTEGER,
  fraud_delta INTEGER,
  current_jailed INTEGER,
  historical_jailed INTEGER,
  jailed_delta INTEGER,
  current_jailed_timestamp INTEGER,
  current_counterfeiting_timestamp INTEGER,
  current_forgeryskill_timestamp INTEGER,
  current_fraud_timestamp INTEGER,
  current_scammingskill_timestamp INTEGER,
  historical_jailed_timestamp INTEGER,
  historical_counterfeiting_timestamp INTEGER,
  historical_forgeryskill_timestamp INTEGER,
  historical_fraud_timestamp INTEGER,
  historical_scammingskill_timestamp INTEGER,
  lookback_seconds INTEGER NOT NULL,
  historical_timestamp_requested INTEGER NOT NULL,
  notes_json TEXT NOT NULL,
  current_personalstats_json TEXT,
  historical_personalstats_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE arrest_scout_future_targets (
  target_user_id INTEGER PRIMARY KEY,
  name TEXT,
  best_score INTEGER NOT NULL DEFAULT 0,
  last_classification TEXT NOT NULL,
  last_counterfeiting_delta INTEGER,
  last_fraud_delta INTEGER,
  last_jailed_delta INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  next_check_after INTEGER,
  latest_snapshot_id TEXT,
  notes_json TEXT NOT NULL
);

CREATE INDEX idx_arrest_scout_snapshots_scanned
  ON arrest_scout_snapshots(scanned_at DESC);

CREATE INDEX idx_arrest_scout_results_snapshot_class_score
  ON arrest_scout_results(snapshot_id, classification, score DESC);

CREATE INDEX idx_arrest_scout_results_target_created
  ON arrest_scout_results(target_user_id, created_at DESC);

CREATE INDEX idx_arrest_scout_future_targets_due_score
  ON arrest_scout_future_targets(next_check_after ASC, best_score DESC);

CREATE TABLE torn_api_keys (
  id TEXT PRIMARY KEY,
  label TEXT,
  encrypted_key TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL UNIQUE,
  submitted_by_torn_user_id INTEGER,
  owner_torn_user_id INTEGER,
  owner_name TEXT,
  access_level INTEGER,
  access_type TEXT,
  faction_access INTEGER,
  status TEXT NOT NULL,
  allowed_features_json TEXT NOT NULL,
  max_requests_per_minute INTEGER,
  last_validated_at INTEGER,
  last_used_at INTEGER,
  last_used_feature TEXT,
  monitor_last_used_at INTEGER,
  paused_until INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE torn_api_key_usage_windows (
  key_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (key_id, window_start)
);

CREATE INDEX idx_torn_api_keys_submitter
  ON torn_api_keys(submitted_by_torn_user_id, updated_at DESC);

CREATE INDEX idx_torn_api_keys_status
  ON torn_api_keys(status, paused_until, last_used_at);

CREATE INDEX idx_torn_api_key_usage_windows_window
  ON torn_api_key_usage_windows(window_start DESC);
