import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const WRITE_PATTERN =
  /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+war_(member_stats|member_combat_buckets|summary)\b/i;

describe("war stats ownership", () => {
  it("keeps calculated war stat table writes inside src/warStats", () => {
    const root = join(process.cwd(), "src");
    const offenders = sourceFiles(root)
      .filter((file) => !file.endsWith(".test.ts"))
      .filter((file) => !file.endsWith(".test.js"))
      .filter((file) => !relative(root, file).split(sep).includes("warStats"))
      .filter((file) => WRITE_PATTERN.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        return sourceFiles(path);
      }
      return path.endsWith(".ts") || path.endsWith(".js") ? [path] : [];
    });
}
