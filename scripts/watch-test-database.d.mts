import type { Env } from "../src/types";
export function watchDatabase(initialNow: number): {
  sqlite: { exec(sql: string): void; close(): void };
  setNow(value: number): void;
  env: Env;
};
