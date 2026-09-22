import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function chainWatchDatabase(now, migrate = true) {
  const db = watchDatabase(now);
  const schema = readFileSync(new URL("../schema/current.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const table of ["wars", "sync_state", "attacks", "chain_watch_state"]) {
    const statement = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    if (!statement) throw new Error(`Missing schema for ${table}`);
    db.sqlite.exec(statement);
  }
  const applyMigration = () => {
    db.sqlite.exec(readFileSync(new URL("../migrations/0148_create_faction_chain_watch_state.sql", import.meta.url), "utf8"));
    db.sqlite.exec(readFileSync(new URL("../migrations/0158_version_chain_watch_timers.sql", import.meta.url), "utf8"));
  };
  if (migrate) applyMigration();
  return { ...db, applyMigration };
}
