CREATE TABLE IF NOT EXISTS member_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  torn_user_id INTEGER NOT NULL,
  member_name TEXT,
  suggestion TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_suggestions_created
ON member_suggestions(created_at DESC, id DESC);
