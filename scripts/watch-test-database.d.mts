import type { Env } from "../src/types";

export const watchAnnouncementsMigration: string;
export const watchSummaryRevisionsMigration: string;
export function watchDatabase(initialNow: number): {
  sqlite: {
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      run(...values: Array<string | number | null>): unknown;
      get(...values: Array<string | number | null>): Record<string, unknown> | undefined;
      all(...values: Array<string | number | null>): Array<Record<string, unknown>>;
    };
  };
  setNow(value: number): void;
  env: Env;
};
