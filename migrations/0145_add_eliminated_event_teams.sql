CREATE TABLE event_competition_eliminated_teams (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  eliminated_at INTEGER NOT NULL,
  PRIMARY KEY (war_id, team_name)
);
