const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://torn-faction-attacks.moose-3065754.workers.dev";

export type WarType = "all" | "real" | "termed" | "other";

export type OverallStats = {
  total_wars: number;
  faction_attacks: number;
  enemy_attacks: number;
  outside_hits_outgoing: number;
  total_respect_gain: number;
  total_respect_lost: number;
  latest_attack_started: number | null;
};

export type MemberStats = {
  member_id: number;
  member_name: string | null;
  wars_participated: number;
  enemy_attacks_total: number;
  enemy_attacks_successful: number;
  enemy_respect_gained: number;
  enemy_assists: number;
  enemy_hospitalizations: number;
  enemy_mugs: number;
  outside_attacks: number;
  friendly_hospitals: number;
  defends_total: number;
  defends_won: number;
  respect_lost: number;
  first_seen_at: number | null;
  last_seen_at: number | null;
  added_from_report?: number;
};

export type StatsResponse = {
  ok: boolean;
  war_type: Exclude<WarType, "all"> | null;
  overall: OverallStats;
  members: MemberStats[];
};

export type WarSummary = {
  id: number;
  name: string;
  status: string;
  practical_start_time: number;
  practical_finish_time: number | null;
  official_start_time: number | null;
  official_end_time: number | null;
  enemy_faction_id: number | null;
  war_type: Exclude<WarType, "all"> | null;
  torn_war_id: number | null;
  auto_end_enabled: number;
  faction_respect_limit: number | null;
  member_respect_limit: number | null;
  winner_faction_id: number | null;
  torn_report_fetched_at: number | null;
  official_home_score: number | null;
  official_home_attacks: number | null;
  official_enemy_score: number | null;
  official_enemy_attacks: number | null;
  enemy_scouting_auto_attempted_at: number | null;
  finalized_at: number | null;
  faction_attacks: number;
  enemy_attacks: number;
  outside_hits_outgoing: number;
  total_respect_gain: number;
  total_respect_lost: number;
  unique_attackers: number;
  first_attack_at: number | null;
  last_attack_at: number | null;
  summary_updated_at: number | null;
};

export type WarsResponse = {
  ok: boolean;
  wars: WarSummary[];
};

export type WarDetailResponse = {
  ok: boolean;
  war: WarSummary;
  summary: {
    war_id: number;
    faction_attacks: number;
    enemy_attacks: number;
    outside_hits_outgoing: number;
    total_respect_gain: number;
    total_respect_lost: number;
    unique_attackers: number;
    first_attack_at: number | null;
    last_attack_at: number | null;
    updated_at: number;
  } | null;
  members: MemberStats[];
  chain_bonuses: ChainBonusAttack[];
};

export type MemberAttackClassification =
  | "enemy_success"
  | "enemy_assist"
  | "enemy_attempt"
  | "outside"
  | "defend_lost"
  | "defend_won"
  | "other";

export type MemberAttack = {
  id: number;
  started: number | null;
  ended: number | null;
  attacker_id: number | null;
  attacker_name: string | null;
  attacker_faction_id: number | null;
  attacker_faction_name: string | null;
  defender_id: number | null;
  defender_name: string | null;
  defender_faction_id: number | null;
  defender_faction_name: string | null;
  result: string | null;
  respect_gain: number;
  respect_loss: number;
  classification: MemberAttackClassification;
};

export type ChainBonusAttack = Pick<
  MemberAttack,
  | "id"
  | "started"
  | "attacker_id"
  | "attacker_name"
  | "attacker_faction_id"
  | "attacker_faction_name"
  | "defender_id"
  | "defender_name"
  | "defender_faction_id"
  | "defender_faction_name"
  | "result"
  | "respect_gain"
  | "respect_loss"
> & {
  chain: number | null;
  adjusted_respect_gain: number;
  respect_removed: number;
};

export type MemberAttacksResponse = {
  ok: boolean;
  member_id: number;
  paging: {
    returned: number;
  };
  attacks: MemberAttack[];
};

export type WarActivityBucket = {
  bucket_start: number;
  enemy_success: number;
  enemy_assist: number;
  outside: number;
  defend_lost: number;
  defend_won: number;
};

export type WarActivityResponse = {
  ok: boolean;
  bucket_minutes: number;
  buckets: WarActivityBucket[];
};

export type FactionActivityHeatmapRow = {
  faction_id: number;
  date: string;
  interval_index: number;
  active_count: number;
  total_count: number;
  sampled_at: number;
};

export type FactionActivityHeatmapResponse = {
  ok: boolean;
  interval_minutes: number;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
  };
  home_faction_id: number;
  rows: FactionActivityHeatmapRow[];
};

export type EnemyFactionMember = {
  member_id: number;
  faction_id: number;
  name: string;
  level: number | null;
  position: string | null;
  days_in_faction: number | null;
  is_revivable: number | null;
  estimated_stats: number | null;
  estimated_stats_updated_at: number | null;
  updated_at: number;
};

export type EnemyScoutingResponse = {
  ok: boolean;
  refreshed: boolean;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
  };
  summary: {
    members_loaded: number;
    average_level: number;
    average_estimated_stats: number | null;
    missing_estimated_stats: number;
    stats_available: number;
  };
  members: EnemyFactionMember[];
};

export type ScoutingComparisonResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    enemy_faction_id: number | null;
  };
  home: {
    faction_id: number;
    members: EnemyFactionMember[];
  };
  enemy: {
    faction_id: number;
    members: EnemyFactionMember[];
  };
};

export type ReportDiscrepancyGroup = {
  count: number;
  respect_gain: number;
  attacks: Array<Pick<
    MemberAttack,
    | "id"
    | "started"
    | "attacker_id"
    | "attacker_name"
    | "attacker_faction_id"
    | "attacker_faction_name"
    | "defender_id"
    | "defender_name"
    | "defender_faction_id"
    | "defender_faction_name"
    | "result"
    | "respect_gain"
    | "respect_loss"
  > & Partial<Pick<ChainBonusAttack, "chain" | "adjusted_respect_gain" | "respect_removed">>>;
};

export type ReportDiscrepanciesResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
    practical_start_time: number;
    practical_finish_time: number | null;
    official_start_time: number | null;
    official_end_time: number | null;
    enemy_faction_id: number | null;
    war_type: Exclude<WarType, "all">;
  };
  groups: Record<string, ReportDiscrepancyGroup>;
};

export type AdminWarPayload = {
  name?: string;
  practical_start_time?: number;
  practical_finish_time?: number;
  official_start_time?: number;
  official_finish_time?: number;
  enemy_faction_id?: number;
  war_type: Exclude<WarType, "all">;
  torn_war_id?: number;
  auto_end_enabled?: boolean;
  faction_respect_limit?: number;
  member_respect_limit?: number;
};

export type AttackWindowPayload = {
  practical_start_time: number;
  practical_finish_time: number;
  limit?: number;
};

export type AuthUser = {
  id: number;
  name: string | null;
  key_access_level?: number | null;
  key_access_type?: string | null;
  key_faction_access?: boolean;
};

export type AuthSession = {
  ok: boolean;
  token?: string;
  access_level: "member" | "admin";
  expires_at: number;
  user: AuthUser;
};

const AUTH_TOKEN_STORAGE_KEY = "tornFactionAuthToken";
const AUTH_SESSION_STORAGE_KEY = "tornFactionAuthSession";

export function getStoredAuthSession(): AuthSession | null {
  const raw = window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as AuthSession;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      clearStoredAuthSession();
      return null;
    }
    return session;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

export function clearStoredAuthSession() {
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export async function authenticateTornKey(key: string): Promise<AuthSession> {
  const session = await postJson<AuthSession>("/api/auth/torn", { key }, false);
  if (session.token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, session.token);
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}

export async function refreshAuthSession(): Promise<AuthSession | null> {
  if (!getAuthToken()) {
    return null;
  }

  try {
    const session = await getJson<AuthSession>("/api/auth/me", true);
    window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

export async function getStats(warType: WarType): Promise<StatsResponse> {
  return getJson<StatsResponse>(`/api/stats${queryForWarType(warType)}`);
}

export async function getWars(warType: WarType): Promise<WarsResponse> {
  return getJson<WarsResponse>(`/api/wars${queryForWarType(warType)}`);
}

export async function getWar(name: string): Promise<WarDetailResponse> {
  return getJson<WarDetailResponse>(`/api/wars/${encodeURIComponent(name)}`);
}

export async function getWarMemberAttacks(
  warName: string,
  memberId: number,
): Promise<MemberAttacksResponse> {
  return getJson<MemberAttacksResponse>(
    `/api/wars/${encodeURIComponent(warName)}/members/${memberId}/attacks`,
  );
}

export async function getWarActivity(warName: string): Promise<WarActivityResponse> {
  return getJson<WarActivityResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity?bucket_minutes=15`,
  );
}

export async function getWarActivityHeatmap(
  warName: string,
): Promise<FactionActivityHeatmapResponse> {
  return getJson<FactionActivityHeatmapResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity-heatmap`,
  );
}

export async function getWarReportDiscrepancies(
  warName: string,
): Promise<ReportDiscrepanciesResponse> {
  return getJson<ReportDiscrepanciesResponse>(
    `/api/wars/${encodeURIComponent(warName)}/report-discrepancies`,
  );
}

export async function getEnemyScouting(warName: string): Promise<EnemyScoutingResponse> {
  return getJson<EnemyScoutingResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-scouting`,
  );
}

export async function getScoutingComparison(
  warName: string,
): Promise<ScoutingComparisonResponse> {
  return getJson<ScoutingComparisonResponse>(
    `/api/wars/${encodeURIComponent(warName)}/scouting-comparison`,
  );
}

export async function checkHealth(): Promise<unknown> {
  return getJson("/api/health");
}

export async function runIngestion(): Promise<unknown> {
  return postJson("/api/run");
}

export async function rebuildStats(): Promise<unknown> {
  return postJson("/api/rebuild");
}

export async function createWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars", payload);
}

export async function importWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import", payload);
}

export async function previewImportWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import/preview", {
    practical_start_time: payload.practical_start_time,
    practical_finish_time: payload.practical_finish_time,
    official_start_time: payload.official_start_time,
    official_finish_time: payload.official_finish_time,
    war_type: payload.war_type,
    torn_war_id: payload.torn_war_id,
  });
}

export async function pullAttackWindow(payload: AttackWindowPayload): Promise<unknown> {
  return postJson("/api/attacks/window", payload);
}

export async function deleteWar(payload: {
  torn_war_id?: number;
  name?: string;
}): Promise<unknown> {
  return postJson("/api/wars/delete", payload);
}

export async function previewRelinkAttacks(payload: {
  torn_war_id?: number;
  name?: string;
  fetch_missing?: boolean;
}): Promise<unknown> {
  return postJson("/api/wars/relink-attacks", { ...payload, dry_run: true });
}

export async function relinkAttacks(payload: {
  torn_war_id?: number;
  name?: string;
  fetch_missing?: boolean;
}): Promise<unknown> {
  return postJson("/api/wars/relink-attacks", { ...payload, dry_run: false });
}

export async function endActiveWar(): Promise<unknown> {
  return postJson("/api/wars/end");
}

export async function fetchTornWarReport(tornWarId: number): Promise<unknown> {
  return postJson(`/api/torn-wars/${encodeURIComponent(tornWarId)}/report/fetch`);
}

export async function refreshEnemyScouting(warName: string): Promise<EnemyScoutingResponse> {
  return postJson<EnemyScoutingResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-scouting`,
  );
}

async function getJson<T>(path: string, includeAuth = false): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(includeAuth),
  });
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

async function postJson<T = unknown>(
  path: string,
  body?: unknown,
  includeAuth = true,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers:
      body === undefined
        ? authHeaders(includeAuth)
        : { "Content-Type": "application/json", ...authHeaders(includeAuth) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();

  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

function queryForWarType(warType: WarType): string {
  return warType === "all" ? "" : `?war_type=${encodeURIComponent(warType)}`;
}

function getAuthToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

function authHeaders(includeAuth: boolean): Record<string, string> | undefined {
  if (!includeAuth) {
    return undefined;
  }

  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}
