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
  enemy_scouting_auto_attempted_at INTEGER
);

CREATE TABLE sync_state (
  name TEXT PRIMARY KEY,
  last_started INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_war_id INTEGER
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
  faction_attacks INTEGER NOT NULL DEFAULT 0,
  total_respect_gain REAL NOT NULL DEFAULT 0,
  total_respect_lost REAL NOT NULL DEFAULT 0,
  unique_attackers INTEGER NOT NULL DEFAULT 0,
  first_attack_at INTEGER,
  last_attack_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  enemy_attacks INTEGER NOT NULL DEFAULT 0,
  outside_hits_outgoing INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE war_member_stats (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  member_name TEXT,
  enemy_attacks_total INTEGER NOT NULL DEFAULT 0,
  enemy_attacks_successful INTEGER NOT NULL DEFAULT 0,
  enemy_respect_gained REAL NOT NULL DEFAULT 0,
  enemy_assists INTEGER NOT NULL DEFAULT 0,
  enemy_hospitalizations INTEGER NOT NULL DEFAULT 0,
  enemy_mugs INTEGER NOT NULL DEFAULT 0,
  enemy_retaliations INTEGER NOT NULL DEFAULT 0,
  outside_attacks INTEGER NOT NULL DEFAULT 0,
  friendly_hospitals INTEGER NOT NULL DEFAULT 0,
  defends_total INTEGER NOT NULL DEFAULT 0,
  defends_won INTEGER NOT NULL DEFAULT 0,
  respect_lost REAL NOT NULL DEFAULT 0,
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

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions(expires_at);

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
