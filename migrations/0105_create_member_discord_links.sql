CREATE TABLE IF NOT EXISTS member_discord_links (
  torn_user_id INTEGER PRIMARY KEY,
  discord_user_id TEXT NOT NULL UNIQUE
);

