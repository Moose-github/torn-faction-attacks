import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function discordRouteDatabase() {
  const db = watchDatabase(1_900_000_000);
  db.env.DISCORD_GUILD_ID = "111111";
  db.env.DISCORD_BOT_TOKEN = "fixture-token";
  db.sqlite.exec("CREATE TABLE sync_state (name TEXT PRIMARY KEY)");
  for (const migration of ["0111_create_alert_settings.sql", "0130_create_discord_notification_channels.sql"]) {
    db.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  return db;
}
