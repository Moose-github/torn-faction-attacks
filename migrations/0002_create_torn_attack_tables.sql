-- Migration number: 0002
-- Mirrors the Torn faction attack schema that was originally created manually in D1.

CREATE TABLE IF NOT EXISTS wars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'active', 'ended')),
    start_time INTEGER NOT NULL,
    finish_time INTEGER,
    finalized_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    faction_id INTEGER,
    war_type TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
    name TEXT PRIMARY KEY,
    last_started INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_war_id INTEGER
);

CREATE TABLE IF NOT EXISTS attacks (
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

CREATE TABLE IF NOT EXISTS war_summary (
    war_id INTEGER PRIMARY KEY,
    war_name TEXT NOT NULL,
    status TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    finish_time INTEGER,

    faction_attacks INTEGER NOT NULL DEFAULT 0,
    total_respect_gain REAL NOT NULL DEFAULT 0,
    total_respect_lost REAL NOT NULL DEFAULT 0,

    unique_attackers INTEGER NOT NULL DEFAULT 0,
    first_attack_at INTEGER,
    last_attack_at INTEGER,

    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    finalized_at INTEGER,
    enemy_attacks INTEGER NOT NULL DEFAULT 0,
    outside_hits_outgoing INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE IF NOT EXISTS war_member_stats (
    war_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    member_name TEXT,

    attacks_made INTEGER NOT NULL DEFAULT 0,
    attacks_succeeded INTEGER NOT NULL DEFAULT 0,
    respect_gain REAL NOT NULL DEFAULT 0,

    defends_lost INTEGER NOT NULL DEFAULT 0,
    respect_lost REAL NOT NULL DEFAULT 0,

    first_attack_at INTEGER,
    last_attack_at INTEGER,
    attack_assist INTEGER NOT NULL DEFAULT 0,
    outside_attacks INTEGER NOT NULL DEFAULT 0,
    hospitalized_friendly INTEGER NOT NULL DEFAULT 0,
    hospitalized_enemy INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (war_id, member_id),
    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE IF NOT EXISTS member_career_stats (
    member_id INTEGER PRIMARY KEY,
    member_name TEXT,

    wars_participated INTEGER NOT NULL DEFAULT 0,

    attacks_made INTEGER NOT NULL DEFAULT 0,
    attacks_succeeded INTEGER NOT NULL DEFAULT 0,
    respect_gain REAL NOT NULL DEFAULT 0,

    defends_lost INTEGER NOT NULL DEFAULT 0,
    respect_lost REAL NOT NULL DEFAULT 0,

    first_seen_at INTEGER,
    last_seen_at INTEGER,

    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    attack_assist INTEGER NOT NULL DEFAULT 0,
    outside_attacks INTEGER NOT NULL DEFAULT 0,
    hospitalized_friendly INTEGER NOT NULL DEFAULT 0,
    hospitalized_enemy INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attacks_started
    ON attacks(started DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_war_started
    ON attacks(war_id, started DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_attacker_war
    ON attacks(attacker_id, war_id);

CREATE INDEX IF NOT EXISTS idx_attacks_defender_war
    ON attacks(defender_id, war_id);

CREATE INDEX IF NOT EXISTS idx_attacks_attacker_faction_war
    ON attacks(attacker_faction_id, war_id, started DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_defender_faction_war
    ON attacks(defender_faction_id, war_id, started DESC);

CREATE INDEX IF NOT EXISTS idx_attacks_attacker_member_war
    ON attacks(attacker_id, war_id);

CREATE INDEX IF NOT EXISTS idx_attacks_defender_member_war
    ON attacks(defender_id, war_id);

CREATE INDEX IF NOT EXISTS idx_wars_status_started
    ON wars(status, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_war_member_stats_war
    ON war_member_stats(war_id);

CREATE INDEX IF NOT EXISTS idx_member_career_stats_name
    ON member_career_stats(member_name);
