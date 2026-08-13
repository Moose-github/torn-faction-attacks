import { fetchTrackedTornJson } from "./external/torn";
import {
  fetchTornPersonalStatsWithTimestamps,
  type TornPersonalStatsResponse,
} from "./personalStats";
import { parseTornUserJobCompanySnapshot } from "./enemyCompany";
import { runWithTornKeyPool } from "./tornKeyPool";
import type { Env } from "./types";
import { finiteNumber, nowSeconds } from "./utils";

const TORN_USER_API_BASE_URL = "https://api.torn.com/v2/user";
const PLAYER_LOOKUP_FETCH_TIMEOUT_MS = 12_000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export const PLAYER_LOOKUP_PERSONAL_STAT_KEYS = [
  "xantaken",
  "timeplayed",
  "criminaloffenses",
  "refills",
  "traveltimes",
  "activestreak",
  "bestactivestreak",
  "networth",
  "attackswon",
] as const;

export type PlayerLookupPersonalStatKey = (typeof PLAYER_LOOKUP_PERSONAL_STAT_KEYS)[number];

export const PLAYER_LOOKUP_HISTORICAL_STAT_KEYS = [
  "xantaken",
  "timeplayed",
  "criminaloffenses",
  "refills",
  "traveltimes",
  "attackswon",
] as const satisfies readonly PlayerLookupPersonalStatKey[];

export const PLAYER_LOOKUP_CURRENT_ONLY_STAT_KEYS = [
  "activestreak",
  "bestactivestreak",
  "networth",
] as const satisfies readonly PlayerLookupPersonalStatKey[];

export type TornPlayerLookupProfile = {
  id: number;
  name: string;
  level: number | null;
  rank: string | null;
  title: string | null;
  age: number | null;
  factionId: number | null;
  factionName: string | null;
  propertyName: string | null;
  spouseName: string | null;
  spouseId: number | null;
  daysMarried: number | null;
  awards: number | null;
  statusState: string | null;
  statusDescription: string | null;
  lastActionStatus: string | null;
  lastActionTimestamp: number | null;
};

export type PlayerLookupDailyAverage = {
  key: PlayerLookupPersonalStatKey;
  current: number | null;
  previous: number | null;
  delta: number | null;
  periodDays: number | null;
  averagePerDay: number | null;
};

export type TornPlayerLookupJob = {
  companyType: string | null;
  companyRating: number | null;
  companyId: number | null;
};

export type PlayerLookupResult = {
  profile: TornPlayerLookupProfile;
  job: TornPlayerLookupJob;
  currentStats: TornPersonalStatsResponse;
  previousStats: TornPersonalStatsResponse;
  averages: PlayerLookupDailyAverage[];
  windowDays: number;
  currentTimestamp: number;
  previousTimestamp: number;
};

export async function lookupTornPlayer(
  env: Env,
  playerId: number,
  currentTimestamp = nowSeconds(),
): Promise<PlayerLookupResult> {
  const previousTimestamp = currentTimestamp - THIRTY_DAYS_SECONDS;
  const output = await runWithTornKeyPool(env, {
    feature: "enemy_scouting",
    usageCount: 4,
    run: async ({ key, keySource }) => {
      const [profile, job, currentStats, previousStats] = await Promise.all([
        fetchTornPlayerProfile(env, playerId, { apiKey: key, keySource }),
        fetchTornPlayerJob(env, playerId, { apiKey: key, keySource }),
        fetchTornPersonalStatsWithTimestamps(env, playerId, PLAYER_LOOKUP_PERSONAL_STAT_KEYS, {
          apiKey: key,
          keySource,
        }),
        fetchTornPersonalStatsWithTimestamps(env, playerId, PLAYER_LOOKUP_HISTORICAL_STAT_KEYS, {
          timestamp: previousTimestamp,
          apiKey: key,
          keySource,
        }),
      ]);

      return {
        profile,
        job,
        currentStats,
        previousStats,
        averages: buildPlayerLookupAverages(currentStats, previousStats, currentTimestamp),
        windowDays: 30,
        currentTimestamp,
        previousTimestamp,
      };
    },
  });

  return output.result;
}

export async function fetchTornPlayerProfile(
  env: Env,
  playerId: number,
  options: { apiKey: string; keySource: string },
): Promise<TornPlayerLookupProfile> {
  const url = new URL(`${TORN_USER_API_BASE_URL}/${playerId}/profile`);
  const data = await fetchTrackedTornJson<unknown>(
    env,
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${options.apiKey}`,
      },
    },
    {
      feature: "player-lookup:profile",
      keySource: options.keySource,
      timeoutMs: PLAYER_LOOKUP_FETCH_TIMEOUT_MS,
    },
    { service: "Torn player lookup" },
  );

  return normalizeTornPlayerProfile(data, playerId);
}

export async function fetchTornPlayerJob(
  env: Env,
  playerId: number,
  options: { apiKey: string; keySource: string },
): Promise<TornPlayerLookupJob> {
  const url = new URL(`${TORN_USER_API_BASE_URL}/${playerId}/job`);
  const data = await fetchTrackedTornJson<unknown>(
    env,
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: `ApiKey ${options.apiKey}`,
      },
    },
    {
      feature: "player-lookup:job",
      keySource: options.keySource,
      timeoutMs: PLAYER_LOOKUP_FETCH_TIMEOUT_MS,
    },
    { service: "Torn player job" },
  );

  return normalizeTornPlayerJob(data);
}

export function normalizeTornPlayerJob(data: unknown): TornPlayerLookupJob {
  const snapshot = parseTornUserJobCompanySnapshot(data);
  return {
    companyType: snapshot.company_type,
    companyRating: snapshot.company_rating,
    companyId: snapshot.company_id,
  };
}

export function buildPlayerLookupAverages(
  currentStats: TornPersonalStatsResponse,
  previousStats: TornPersonalStatsResponse,
  currentTimestamp = nowSeconds(),
): PlayerLookupDailyAverage[] {
  return PLAYER_LOOKUP_PERSONAL_STAT_KEYS.map((key) => {
    const currentStat = currentStats[key];
    const previousStat = previousStats[key];
    const current = currentStat?.value ?? null;
    const previous = previousStat?.value ?? null;
    const periodDays = returnedPeriodDays(currentStat?.timestamp ?? currentTimestamp, previousStat?.timestamp ?? null);
    const delta = current !== null && previous !== null
      ? Math.max(0, current - previous)
      : null;
    return {
      key,
      current,
      previous,
      delta,
      periodDays,
      averagePerDay: delta === null || periodDays === null ? null : delta / periodDays,
    };
  });
}

function returnedPeriodDays(currentTimestamp: number | null, previousTimestamp: number | null): number | null {
  if (currentTimestamp === null || previousTimestamp === null || currentTimestamp <= previousTimestamp) {
    return null;
  }

  return Math.max(1, Math.round((currentTimestamp - previousTimestamp) / (24 * 60 * 60)));
}

export function normalizeTornPlayerProfile(
  data: unknown,
  requestedPlayerId: number,
): TornPlayerLookupProfile {
  const source =
    readObject(data, "basic") ??
    readObject(data, "profile") ??
    readObject(data, "user") ??
    (isPlainObject(data) ? data as Record<string, unknown> : {});
  const id = positiveInteger(
    source.id ??
    source.player_id ??
    source.user_id,
  ) ?? requestedPlayerId;
  const faction = readObject(source, "faction");
  const property = readObject(source, "property");
  const spouse = readObject(source, "spouse") ?? readObject(source, "married");
  const awards = readObject(source, "awards");
  const status = readObject(source, "status");
  const lastAction = readObject(source, "last_action");

  return {
    id,
    name: cleanString(
      source.name ??
      source.player_name ??
      source.username,
    ) ?? `Torn ${id}`,
    level: finiteNumber(source.level),
    rank: cleanString(source.rank),
    title: cleanString(source.title),
    age: finiteNumber(source.age),
    factionId: positiveInteger(
      faction?.id ??
      faction?.faction_id ??
      source.faction_id,
    ),
    factionName: cleanString(
      faction?.name ??
      faction?.faction_name ??
      source.faction_name,
    ),
    propertyName: cleanString(
      property?.name ??
      property?.property_name ??
      source.property_name,
    ),
    spouseName: cleanString(
      spouse?.name ??
      spouse?.spouse_name ??
      source.spouse_name,
    ),
    spouseId: positiveInteger(
      spouse?.id ??
      spouse?.user_id ??
      spouse?.player_id ??
      source.spouse_id,
    ),
    daysMarried: finiteNumber(
      spouse?.days_married ??
      spouse?.days_married_for ??
      source.days_married,
    ),
    awards: finiteNumber(
      source.awards ??
      source.awards_count ??
      awards?.total ??
      awards?.count,
    ),
    statusState: cleanString(status?.state ?? source.status_state),
    statusDescription: cleanString(status?.description ?? source.status_description),
    lastActionStatus: cleanString(lastAction?.status ?? source.last_action_status),
    lastActionTimestamp: finiteNumber(lastAction?.timestamp ?? source.last_action_timestamp),
  };
}

function readObject(source: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainObject(source)) {
    return null;
  }
  const value = source[key];
  return isPlainObject(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
