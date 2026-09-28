-- Keep explicit revocations from being undone by automatic faction-key grants.
CREATE TABLE IF NOT EXISTS admin_access_revocations (
  torn_user_id INTEGER PRIMARY KEY,
  revoked_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
