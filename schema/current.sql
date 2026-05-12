-- Current D1 schema snapshot.
--
-- This is documentation only. Cloudflare D1 migration history still lives in
-- migrations/ and should remain the source of truth for applied databases.

CREATE TABLE admin_users (
  torn_user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE auth_sessions (
  token TEXT PRIMARY KEY,
  torn_user_id INTEGER NOT NULL,
  access_level TEXT NOT NULL CHECK (access_level IN ('member', 'admin')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
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

CREATE TABLE sync_state (
  name TEXT PRIMARY KEY,
  last_started INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_war_id INTEGER
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

CREATE TABLE war_summary (
  war_id INTEGER PRIMARY KEY,
  attacks_vs_enemy_total INTEGER NOT NULL DEFAULT 0,
  total_respect_gain REAL NOT NULL DEFAULT 0,
  total_respect_gain_raw REAL NOT NULL DEFAULT 0,
  total_respect_lost REAL NOT NULL DEFAULT 0,
  total_respect_lost_raw REAL NOT NULL DEFAULT 0,
  unique_attackers INTEGER NOT NULL DEFAULT 0,
  first_attack_at INTEGER,
  last_attack_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  attacks_from_enemy_total INTEGER NOT NULL DEFAULT 0,
  outside_hits INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE war_member_stats (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  attacks_vs_enemy_total INTEGER NOT NULL DEFAULT 0,
  attacks_vs_enemy_successful INTEGER NOT NULL DEFAULT 0,
  respect_gained REAL NOT NULL DEFAULT 0,
  respect_gained_raw REAL NOT NULL DEFAULT 0,
  chain_bonus_hits_vs_enemy INTEGER NOT NULL DEFAULT 0,
  chain_bonus_respect_removed REAL NOT NULL DEFAULT 0,
  chain_bonus_hit_values_vs_enemy TEXT NOT NULL DEFAULT '',
  chain_bonus_hit_details_vs_enemy TEXT NOT NULL DEFAULT '',
  assists_vs_enemy INTEGER NOT NULL DEFAULT 0,
  hospitalizations_vs_enemy INTEGER NOT NULL DEFAULT 0,
  mugs_vs_enemy INTEGER NOT NULL DEFAULT 0,
  retaliations_vs_enemy INTEGER NOT NULL DEFAULT 0,
  outside_hits INTEGER NOT NULL DEFAULT 0,
  friendly_hosps INTEGER NOT NULL DEFAULT 0,
  average_fair_fight REAL,
  defends_total INTEGER NOT NULL DEFAULT 0,
  defends_won INTEGER NOT NULL DEFAULT 0,
  defends_other INTEGER NOT NULL DEFAULT 0,
  respect_lost REAL NOT NULL DEFAULT 0,
  respect_lost_raw REAL NOT NULL DEFAULT 0,
  enemy_chain_bonus_hits_received INTEGER NOT NULL DEFAULT 0,
  enemy_chain_bonus_respect_removed REAL NOT NULL DEFAULT 0,
  enemy_chain_bonus_hit_values_received TEXT NOT NULL DEFAULT '',
  enemy_chain_bonus_hit_details_received TEXT NOT NULL DEFAULT '',
  first_action_at INTEGER,
  last_action_at INTEGER,
  added_from_report INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (war_id, member_id),
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE enemy_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  is_revivable INTEGER,
  estimated_stats INTEGER,
  estimated_stats_updated_at INTEGER,
  networth INTEGER,
  networth_updated_at INTEGER,
  status_state TEXT,
  status_description TEXT,
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
  status_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE home_faction_members (
  member_id INTEGER PRIMARY KEY,
  faction_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level INTEGER,
  position TEXT,
  days_in_faction INTEGER,
  is_revivable INTEGER,
  estimated_stats INTEGER,
  estimated_stats_updated_at INTEGER,
  networth INTEGER,
  networth_updated_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
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

CREATE TABLE member_lifestyle_stats (
  member_id INTEGER PRIMARY KEY,
  member_name TEXT,
  level INTEGER,
  position TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  updated_at INTEGER,
  error TEXT
);

CREATE TABLE member_lifestyle_stat_snapshots (
  member_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  member_name TEXT,
  xantaken INTEGER,
  overdosed INTEGER,
  refills INTEGER,
  useractivity INTEGER,
  networth INTEGER,
  gymenergy INTEGER,
  gymstrength INTEGER,
  gymspeed INTEGER,
  gymdefense INTEGER,
  gymdexterity INTEGER,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, snapshot_date)
);

CREATE TABLE dice_game_losses (
  torn_user_id INTEGER PRIMARY KEY,
  member_name TEXT,
  xanax_balance INTEGER NOT NULL DEFAULT 250,
  total_gained INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  rolls INTEGER NOT NULL DEFAULT 0,
  consecutive_losses INTEGER NOT NULL DEFAULT 0,
  streak_loss_total INTEGER NOT NULL DEFAULT 0,
  pity_after_losses INTEGER NOT NULL DEFAULT 0,
  last_roll_won INTEGER NOT NULL DEFAULT 0,
  largest_loss INTEGER NOT NULL DEFAULT 0,
  last_bet_amount INTEGER,
  last_loss_amount INTEGER,
  last_verdict TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_attacks_started
  ON attacks(started DESC);

CREATE INDEX idx_attacks_war_started
  ON attacks(war_id, started DESC);

CREATE INDEX idx_attacks_attacker_faction_war
  ON attacks(attacker_faction_id, war_id, started DESC);

CREATE INDEX idx_attacks_defender_faction_war
  ON attacks(defender_faction_id, war_id, started DESC);

CREATE INDEX idx_attacks_war_attacker_started
  ON attacks(war_id, attacker_id, started DESC);

CREATE INDEX idx_attacks_war_defender_started
  ON attacks(war_id, defender_id, started DESC);

CREATE INDEX idx_attacks_war_ingest_run
  ON attacks(war_id, ingest_run_id);

CREATE INDEX idx_wars_status_practical_start
  ON wars(status, practical_start_time DESC);

CREATE INDEX idx_wars_war_type
  ON wars(war_type);

CREATE INDEX idx_wars_torn_war_id
  ON wars(torn_war_id);

CREATE UNIQUE INDEX idx_wars_torn_war_id_unique
  ON wars(torn_war_id)
  WHERE torn_war_id IS NOT NULL;

CREATE INDEX idx_wars_lower_name
  ON wars(LOWER(name));

CREATE INDEX idx_war_member_stats_war
  ON war_member_stats(war_id);

CREATE INDEX idx_member_stats_respect_sort
  ON war_member_stats(war_id, respect_gained DESC, attacks_vs_enemy_successful DESC, attacks_vs_enemy_total DESC);

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions(expires_at);

CREATE INDEX idx_ingestion_runs_started
  ON ingestion_runs(started_at DESC);

CREATE INDEX idx_scheduled_maintenance_runs_started
  ON scheduled_maintenance_runs(started_at DESC);

CREATE INDEX idx_scheduled_maintenance_tasks_run
  ON scheduled_maintenance_tasks(run_id);

CREATE INDEX idx_enemy_faction_members_faction
  ON enemy_faction_members(faction_id);

CREATE INDEX idx_enemy_faction_members_ranked
  ON enemy_faction_members(faction_id, estimated_stats DESC, level DESC, name);

CREATE INDEX idx_home_faction_members_faction
  ON home_faction_members(faction_id);

CREATE INDEX idx_home_faction_members_ranked
  ON home_faction_members(faction_id, estimated_stats DESC, level DESC, name);

CREATE INDEX idx_faction_activity_heatmap_sampled
  ON faction_activity_heatmap(sampled_at);

CREATE INDEX idx_faction_activity_heatmap_faction_sampled
  ON faction_activity_heatmap(faction_id, sampled_at);

CREATE INDEX idx_member_lifestyle_stats_updated
  ON member_lifestyle_stats(updated_at);

CREATE INDEX idx_member_lifestyle_snapshots_date
  ON member_lifestyle_stat_snapshots(snapshot_date);

CREATE INDEX idx_dice_game_losses_total_lost
  ON dice_game_losses(total_lost DESC, rolls DESC);
