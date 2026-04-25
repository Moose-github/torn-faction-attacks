-- Migration number: 0003
-- Rebuilds member performance tables with dashboard-oriented columns.
-- This project is still in testing, so old summary data can be rebuilt from attacks.

DROP TABLE IF EXISTS member_career_stats;
DROP TABLE IF EXISTS war_member_stats;

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

    outside_attacks INTEGER NOT NULL DEFAULT 0,
    friendly_hospitals INTEGER NOT NULL DEFAULT 0,

    defends_total INTEGER NOT NULL DEFAULT 0,
    defends_won INTEGER NOT NULL DEFAULT 0,
    respect_lost REAL NOT NULL DEFAULT 0,

    first_action_at INTEGER,
    last_action_at INTEGER,

    PRIMARY KEY (war_id, member_id),
    FOREIGN KEY (war_id) REFERENCES wars(id)
);

CREATE TABLE member_career_stats (
    member_id INTEGER PRIMARY KEY,
    member_name TEXT,

    wars_participated INTEGER NOT NULL DEFAULT 0,

    enemy_attacks_total INTEGER NOT NULL DEFAULT 0,
    enemy_attacks_successful INTEGER NOT NULL DEFAULT 0,
    enemy_respect_gained REAL NOT NULL DEFAULT 0,

    enemy_assists INTEGER NOT NULL DEFAULT 0,
    enemy_hospitalizations INTEGER NOT NULL DEFAULT 0,
    enemy_mugs INTEGER NOT NULL DEFAULT 0,

    outside_attacks INTEGER NOT NULL DEFAULT 0,
    friendly_hospitals INTEGER NOT NULL DEFAULT 0,

    defends_total INTEGER NOT NULL DEFAULT 0,
    defends_won INTEGER NOT NULL DEFAULT 0,
    respect_lost REAL NOT NULL DEFAULT 0,

    first_seen_at INTEGER,
    last_seen_at INTEGER,

    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_war_member_stats_war
    ON war_member_stats(war_id);

CREATE INDEX IF NOT EXISTS idx_member_career_stats_name
    ON member_career_stats(member_name);
