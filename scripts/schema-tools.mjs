#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(rootDir, "migrations");
const schemaPath = path.join(rootDir, "schema", "current.sql");
const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const showExplain = args.has("--explain");
const explainQueries = [
  "EXPLAIN QUERY PLAN SELECT * FROM stock_price_snapshots WHERE stock_id = ? AND observed_at <= ? ORDER BY observed_at DESC LIMIT 1;",
  "EXPLAIN QUERY PLAN SELECT * FROM stock_paper_trades WHERE account_id = ? ORDER BY executed_at DESC LIMIT 20;",
  "EXPLAIN QUERY PLAN SELECT * FROM stock_copy_movement_events WHERE source_player_id = ? ORDER BY observed_at DESC LIMIT 20;",
  "EXPLAIN QUERY PLAN SELECT * FROM member_personal_stats_recent WHERE member_id = ? AND stat_name = ?;",
  "EXPLAIN QUERY PLAN SELECT * FROM trade_item_snapshots WHERE item_id = ? ORDER BY observed_at DESC LIMIT 1;",
];

const migrationFiles = readdirSync(migrationDir)
  .filter((file) => /^\d+_.+\.sql$/i.test(file))
  .sort((a, b) => a.localeCompare(b));
const prefixes = new Map();
for (const file of migrationFiles) {
  const prefix = file.match(/^(\d+)_/)?.[1];
  if (!prefix) {
    continue;
  }
  const files = prefixes.get(prefix) ?? [];
  files.push(file);
  prefixes.set(prefix, files);
}

const duplicatePrefixes = [...prefixes.entries()].filter(([, files]) => files.length > 1);
const schemaSql = readFileSync(schemaPath, "utf8");
const tables = [...schemaSql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z0-9_]+)/gi)]
  .map((match) => match[1])
  .sort((a, b) => a.localeCompare(b));
const indexes = [...schemaSql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([A-Za-z0-9_]+)/gi)]
  .map((match) => match[1])
  .sort((a, b) => a.localeCompare(b));

console.log("Schema summary");
console.log(`- migrations: ${migrationFiles.length}`);
console.log(`- migration prefixes: ${prefixes.size}`);
console.log(`- tables in schema/current.sql: ${tables.length}`);
console.log(`- indexes in schema/current.sql: ${indexes.length}`);

if (duplicatePrefixes.length > 0) {
  console.log("");
  console.log(strict ? "Duplicate migration prefixes:" : "Duplicate migration prefixes (warning):");
  for (const [prefix, files] of duplicatePrefixes) {
    console.log(`- ${prefix}: ${files.join(", ")}`);
  }
  if (!strict) {
    console.log("- run with --strict to fail on duplicate migration prefixes");
  }
}

if (showExplain) {
  console.log("");
  console.log("Useful EXPLAIN QUERY PLAN checks");
  for (const query of explainQueries) {
    console.log(`- ${query}`);
  }
}

if (strict && duplicatePrefixes.length > 0) {
  process.exitCode = 1;
}
