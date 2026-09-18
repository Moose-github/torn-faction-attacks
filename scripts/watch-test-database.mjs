import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Real SQLite (including the production triggers), with D1's transactional batch
// contract. No mocks of assignment or scheduling rules.
export function watchDatabase(initialNow) {
  let now = initialNow;
  const sqlite = new DatabaseSync(":memory:");
  sqlite.function("unixepoch", () => now);
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE home_faction_members(member_id INTEGER PRIMARY KEY, name TEXT, is_current INTEGER);
    INSERT INTO home_faction_members VALUES (1, 'Alice', 1), (2, 'Bob', 1), (3, 'Former', 0);
    CREATE TABLE discord_member_links(torn_user_id INTEGER PRIMARY KEY, discord_user_id TEXT);
    INSERT INTO discord_member_links VALUES (1, '111'), (2, '222'), (3, '333');`);
  sqlite.exec(readFileSync(new URL("../migrations/0146_create_chain_watch_schedules.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../migrations/0147_resume_chain_watch_daily_sheets.sql", import.meta.url), "utf8"));
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    execute() {
      const results = sqlite.prepare(this.sql).all(...this.values);
      const changes = Number(sqlite.prepare("SELECT changes() AS n").get().n);
      return { results, success: true, meta: { changes } };
    }
    async run() { return this.execute(); }
    async all() { return this.execute(); }
    async first() { return this.execute().results[0] ?? null; }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { sqlite, setNow(value) { now = value; }, env: { DB, DISCORD_GUILD_ID: "guild" } };
}
