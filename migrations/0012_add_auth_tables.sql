CREATE TABLE IF NOT EXISTS admin_users (
  torn_user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  torn_user_id INTEGER NOT NULL,
  name TEXT,
  access_level TEXT NOT NULL CHECK (access_level IN ('member', 'admin')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);
