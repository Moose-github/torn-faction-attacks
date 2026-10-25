-- Torn can return a valid treat counter with an explicitly unowned basket.
-- Preserve all existing snapshots while allowing null basket metadata.
CREATE TABLE event_competition_snapshots_nullable_basket (
  war_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  poll_kind TEXT NOT NULL,
  target_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  treats_collected INTEGER NOT NULL,
  basket_id INTEGER,
  basket_name TEXT,
  PRIMARY KEY (war_id, member_id, poll_kind, target_at),
  FOREIGN KEY (war_id, member_id) REFERENCES event_competition_members(war_id, member_id) ON DELETE CASCADE
);

INSERT INTO event_competition_snapshots_nullable_basket
  (war_id, member_id, poll_kind, target_at, observed_at, treats_collected, basket_id, basket_name)
SELECT war_id, member_id, poll_kind, target_at, observed_at, treats_collected, basket_id, basket_name
FROM event_competition_snapshots;

DROP TABLE event_competition_snapshots;
ALTER TABLE event_competition_snapshots_nullable_basket RENAME TO event_competition_snapshots;
CREATE INDEX event_competition_history ON event_competition_snapshots(war_id, observed_at);
