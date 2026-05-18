import {
  deleteSyncState,
  deleteSyncStatesByPrefix,
  hasSyncState,
  readExistingSyncStateNames,
  upsertSyncTimestamp,
} from "./syncState";
import { Env } from "./types";

export async function isSyncLatchSet(env: Env, name: string): Promise<boolean> {
  return hasSyncState(env, name);
}

export async function readSetSyncLatches(env: Env, names: string[]): Promise<Set<string>> {
  return readExistingSyncStateNames(env, names);
}

export async function setSyncLatch(env: Env, name: string, setAt: number): Promise<void> {
  await upsertSyncTimestamp(env, name, setAt);
}

export async function clearSyncLatch(env: Env, name: string): Promise<void> {
  await deleteSyncState(env, name);
}

export async function clearSyncLatchesByPrefix(
  env: Env,
  prefix: string,
): Promise<D1Result> {
  return deleteSyncStatesByPrefix(env, prefix);
}
