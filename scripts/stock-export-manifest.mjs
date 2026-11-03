import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// Compare D1 --no-schema exports without loading the price history into memory.
// Hash each table independently because schema creation order can differ.
export async function stockExportManifest(file) {
  const tables = [...readFileSync(new URL("../schema/stocks.sql", import.meta.url), "utf8").matchAll(/CREATE TABLE (stock_\w+) /g)].map(m => m[1]);
  const state = new Map(tables.map(table => [table, { hash: createHash("sha256"), insertStatements: 0 }]));
  let current;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const match = line.match(/^INSERT INTO "(stock_\w+)" /);
    if (match) {
      current = state.get(match[1]);
      if (!current) throw new Error(`Unexpected stock table: ${match[1]}`);
      current.insertStatements++;
    } else if (/^PRAGMA /.test(line) || !line.trim()) {
      continue;
    } else if (!current || /^(CREATE|DROP|DELETE|UPDATE|INSERT) /.test(line)) {
      throw new Error("Expected a stock-only D1 data export");
    }
    current.hash.update(line + "\n");
  }
  return Object.fromEntries([...state].map(([table, value]) => [table, { insertStatements: value.insertStatements, sha256: value.hash.digest("hex") }]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error("Usage: node scripts/stock-export-manifest.mjs export.sql manifest.json");
  const manifest = await stockExportManifest(source);
  writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}
