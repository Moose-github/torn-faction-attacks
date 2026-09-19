import { watchDatabase } from "./watch-test-database.mjs";
export function chainWatchDatabase(now: number, migrate?: boolean): ReturnType<typeof watchDatabase> & {
  applyMigration(): void;
};
