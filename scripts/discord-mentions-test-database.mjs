import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function discordMentionsDatabase(migrate = true) {
  const db = watchDatabase(1900000000);
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const table of ["discord_admin_alert_subscriptions", "discord_member_alert_subscriptions"]) {
    const sql = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!sql) throw new Error(`Missing schema for ${table}`);
    db.sqlite.exec(sql.replace("'user', 'role', 'everyone', 'here'", "'user', 'role'"));
  }
  db.sqlite.exec(`CREATE INDEX idx_discord_admin_alert_subscriptions_alert ON discord_admin_alert_subscriptions (alert_key, enabled)`);
  const applyMigration = () => db.sqlite.exec(readFileSync(new URL("../migrations/0149_add_discord_broadcast_mentions.sql", import.meta.url), "utf8"));
  if (migrate) applyMigration();
  db.env.DISCORD_GUILD_ID = "111111";
  db.env.DISCORD_BOT_TOKEN = "fixture-token";
  return { ...db, applyMigration };
}
