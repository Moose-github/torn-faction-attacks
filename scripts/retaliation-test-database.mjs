import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function retaliationDatabase(now) {
  const db = watchDatabase(now);
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  db.sqlite.exec("CREATE TABLE wars (id INTEGER PRIMARY KEY)");
  for (const table of ["attacks", "retaliation_claim_signals", "retaliation_board_state", "sync_state"]) {
    const sql = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!sql) throw new Error(`Missing schema for ${table}`);
    db.sqlite.exec(sql);
  }
  db.sqlite.exec(readFileSync(new URL("../migrations/0188_create_retaliation_discord_messages.sql", import.meta.url), "utf8"));
  return db;
}
