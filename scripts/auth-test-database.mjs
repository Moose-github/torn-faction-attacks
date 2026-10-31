import { readFileSync } from "node:fs";
import { watchDatabase } from "./watch-test-database.mjs";

export function authDatabase() {
  const db = watchDatabase(Math.floor(Date.now() / 1000));
  for (const migration of ["0012_add_auth_tables.sql", "0172_add_admin_access_revocations.sql"]) {
    db.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  return db;
}
