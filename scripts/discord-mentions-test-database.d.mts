import { watchDatabase } from "./watch-test-database.mjs";
export function discordMentionsDatabase(migrate?: boolean): ReturnType<typeof watchDatabase> & { applyMigration(): void };
