ALTER TABLE wars ADD COLUMN event_type TEXT NOT NULL DEFAULT 'general'
  CHECK (event_type IN ('general', 'elimination', 'halloween'));
ALTER TABLE wars ADD COLUMN competition_refresh_hours INTEGER NOT NULL DEFAULT 6
  CHECK (competition_refresh_hours IN (6, 12));

CREATE TABLE event_competition_state (
  war_id INTEGER PRIMARY KEY REFERENCES wars(id) ON DELETE CASCADE,
  initialized_at INTEGER NOT NULL,
  final_requested_at INTEGER,
  finish_at INTEGER
);

CREATE TABLE event_competition_members (
  war_id INTEGER NOT NULL REFERENCES wars(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  member_name TEXT NOT NULL,
  report_exempt INTEGER NOT NULL DEFAULT 0,
  participation TEXT CHECK (participation IN ('participating', 'not_participating')),
  team_name TEXT,
  captured_at INTEGER,
  baseline_treats INTEGER,
  baseline_at INTEGER,
  latest_treats INTEGER,
  latest_at INTEGER,
  basket_id INTEGER,
  basket_name TEXT,
  poll_kind TEXT NOT NULL DEFAULT 'initial' CHECK (poll_kind IN ('initial', 'refresh', 'final')),
  poll_due_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  final_observed_at INTEGER,
  PRIMARY KEY (war_id, member_id)
);
CREATE INDEX event_competition_due ON event_competition_members(poll_due_at, lease_until);

CREATE TABLE event_competition_snapshots (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  poll_kind TEXT NOT NULL,
  target_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  treats_collected INTEGER NOT NULL,
  basket_id INTEGER NOT NULL,
  basket_name TEXT NOT NULL,
  PRIMARY KEY (war_id, member_id, poll_kind, target_at),
  FOREIGN KEY (war_id, member_id) REFERENCES event_competition_members(war_id, member_id) ON DELETE CASCADE
);
CREATE INDEX event_competition_history ON event_competition_snapshots(war_id, observed_at);
