import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function watchAlertDatabase(now) {
  const db = watchDatabase(now);
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const table of ["alert_settings", "discord_notification_channels", "discord_admin_alert_subscriptions", "discord_member_alert_subscriptions"]) {
    const sql = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!sql) throw new Error(`Missing schema for ${table}`);
    db.sqlite.exec(sql);
  }
  return db;
}
