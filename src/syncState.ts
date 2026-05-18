import { Env } from "./types";

export type SyncStateRow = {
  name: string;
  last_started: number | null;
  active_war_id: number | null;
};

export async function readSyncState(env: Env, name: string): Promise<SyncStateRow | null> {
  return (await env.DB.prepare(
    `
    SELECT name, last_started, active_war_id
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(name)
    .first()) as SyncStateRow | null;
}

export async function readSyncTimestamp(env: Env, name: string): Promise<number> {
  const row = await readSyncState(env, name);
  return Number(row?.last_started ?? 0);
}

export async function hasSyncState(env: Env, name: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT 1
    FROM sync_state
    WHERE name = ?
    LIMIT 1
    `,
  )
    .bind(name)
    .first();

  return row !== null;
}

export async function readExistingSyncStateNames(
  env: Env,
  names: string[],
): Promise<Set<string>> {
  if (names.length === 0) {
    return new Set();
  }

  const placeholders = names.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `
    SELECT name
    FROM sync_state
    WHERE name IN (${placeholders})
    `,
  )
    .bind(...names)
    .all<{ name: string }>();

  return new Set((result.results ?? []).map((row) => row.name));
}

export async function insertSyncStateIfMissing(
  env: Env,
  name: string,
  lastStarted: number,
): Promise<void> {
  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO NOTHING
    `,
  )
    .bind(name, lastStarted)
    .run();
}

export async function upsertSyncTimestamp(
  env: Env,
  name: string,
  lastStarted: number,
  activeWarId?: number | null,
): Promise<void> {
  if (activeWarId === undefined) {
    await env.DB.prepare(
      `
      INSERT INTO sync_state (name, last_started, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        last_started = excluded.last_started,
        updated_at = CURRENT_TIMESTAMP
      `,
    )
      .bind(name, lastStarted)
      .run();
    return;
  }

  await env.DB.prepare(
    `
    INSERT INTO sync_state (name, last_started, active_war_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      last_started = excluded.last_started,
      active_war_id = excluded.active_war_id,
      updated_at = CURRENT_TIMESTAMP
    `,
  )
    .bind(name, lastStarted, activeWarId)
    .run();
}

export async function deleteSyncState(env: Env, name: string): Promise<D1Result> {
  return env.DB.prepare(
    `
    DELETE FROM sync_state
    WHERE name = ?
    `,
  )
    .bind(name)
    .run();
}

export async function deleteSyncStatesByPrefix(
  env: Env,
  prefix: string,
): Promise<D1Result> {
  return env.DB.prepare(
    `
    DELETE FROM sync_state
    WHERE name LIKE ?
    `,
  )
    .bind(`${prefix}%`)
    .run();
}
