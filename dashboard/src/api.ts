const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://torn-faction-attacks.moose-3065754.workers.dev";

export type WarType = "all" | "real" | "termed" | "event";

export type OverallStats = {
  total_wars: number;
  attacks_vs_enemy_total: number;
  attacks_from_enemy_total: number;
  outside_hits: number;
  total_respect_gain: number;
  total_respect_gain_raw: number;
  total_respect_lost: number;
  total_respect_lost_raw: number;
  latest_attack_started: number | null;
};

export type MemberStats = {
  member_id: number;
  member_name: string | null;
  wars_participated: number;
  attacks_vs_enemy_total: number;
  attacks_vs_enemy_successful: number;
  respect_gained: number;
  respect_gained_raw: number;
  chain_bonus_hits_vs_enemy: number;
  chain_bonus_respect_removed: number;
  chain_bonus_hit_values_vs_enemy: string;
  chain_bonus_hit_details_vs_enemy: string;
  assists_vs_enemy: number;
  hospitalizations_vs_enemy: number;
  mugs_vs_enemy: number;
  retaliations_vs_enemy: number;
  outside_hits: number;
  friendly_hosps: number;
  average_fair_fight: number | null;
  member_respect_limit_percent: number | null;
  defends_total: number;
  defends_won: number;
  defends_other: number;
  respect_lost: number;
  respect_lost_raw: number;
  enemy_chain_bonus_hits_received: number;
  enemy_chain_bonus_respect_removed: number;
  enemy_chain_bonus_hit_values_received: string;
  enemy_chain_bonus_hit_details_received: string;
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
  enemy_scouting_status_checked_at: number | null;
  finalized_at: number | null;
  attacks_vs_enemy_total: number;
  attacks_from_enemy_total: number;
  outside_hits: number;
  total_respect_gain: number;
  total_respect_gain_raw: number;
  total_respect_lost: number;
  total_respect_lost_raw: number;
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
    attacks_vs_enemy_total: number;
    attacks_from_enemy_total: number;
    outside_hits: number;
    total_respect_gain: number;
    total_respect_gain_raw: number;
    total_respect_lost: number;
    total_respect_lost_raw: number;
    unique_attackers: number;
    first_attack_at: number | null;
    last_attack_at: number | null;
    updated_at: number;
  } | null;
  members: MemberStats[];
};

export type WarChainBonusesResponse = {
  ok: boolean;
  war: {
    id: number;
    name: string;
  };
  chain_bonuses: ChainBonusAttack[];
};

export type MemberAttackClassification =
  | "enemy_success"
  | "enemy_assist"
  | "retaliation"
  | "enemy_attempt"
  | "outside"
  | "defend_lost"
  | "defend_won"
  | "defend_other"
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
  m_retaliation?: number | null;
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
  adjusted_respect_gain?: number | null;
  respect_removed?: number | null;
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
  defend_other: number;
};

export type WarActivityResponse = {
  ok: boolean;
  bucket_minutes: number;
  window: "practical" | "official";
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
  networth: number | null;
  networth_updated_at: number | null;
  status_state?: string | null;
  status_description?: string | null;
  plane_image_type?: string | null;
  plane_type_label?: string | null;
  travel_type?: string | null;
  travel_type_note?: string | null;
  travel_time_note?: string | null;
  arrival_note?: string | null;
  is_travel_time_range?: boolean;
  travel_origin?: string | null;
  travel_destination?: string | null;
  travel_signature?: string | null;
  travel_detected_at?: number | null;
  travel_started_after?: number | null;
  travel_started_before?: number | null;
  estimated_arrival_at?: number | null;
  estimated_arrival_earliest?: number | null;
  estimated_arrival_latest?: number | null;
  status_updated_at?: number | null;
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
    networth_available: number;
    traveling: number;
    status_checked_at: number | null;
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
  member_report_comparison?: {
    available: boolean;
    totals: MemberReportComparisonTotals;
    mismatches: MemberReportComparisonRow[];
  };
};

export type MemberReportComparisonTotals = {
  local_attacks: number;
  report_attacks: number;
  attack_diff: number;
  local_raw_respect: number;
  report_score: number;
  respect_diff: number;
};

export type MemberReportComparisonRow = MemberReportComparisonTotals & {
  member_id: number;
  member_name: string | null;
};

export type AdminWarPayload = {
  id?: number;
  status?: string;
  name?: string;
  practical_start_time?: number;
  practical_finish_time?: number | null;
  official_start_time?: number | null;
  official_end_time?: number | null;
  enemy_faction_id?: number | null;
  war_type: Exclude<WarType, "all">;
  torn_war_id?: number | null;
  auto_end_enabled?: boolean;
  faction_respect_limit?: number | null;
  member_respect_limit?: number | null;
};

export type AttackWindowPayload = {
  practical_start_time: number;
  practical_finish_time: number;
  limit?: number;
};

export type IngestionRun = {
  id: string;
  trigger_source: string;
  started_at: number;
  ranked_war_checked_at: number | null;
  attacks_fetch_finished_at: number | null;
  d1_writes_finished_at: number | null;
  stats_finished_at: number | null;
  report_finished_at: number | null;
  finished_at: number | null;
  latest_attack_started: number | null;
  fetched_pages: number;
  fetched_attacks: number;
  wrote_batches: number;
  saw_rows: number;
  active_war_id: number | null;
  status: string;
  error: string | null;
};

export type IngestionRunResponse = {
  ok: boolean;
  run: IngestionRun | null;
};

export type MemberLifestyleStats = {
  member_id: number;
  member_name: string | null;
  overdosed: number;
  average_xantaken: number;
  adjusted_average_xantaken: number;
  average_refills: number;
  average_useractivity: number;
  networth: number | null;
  average_gymenergy: number;
  average_gymstrength: number;
  average_gymspeed: number;
  average_gymdefense: number;
  average_gymdexterity: number;
  first_snapshot_date: string | null;
  last_snapshot_date: string | null;
  updated_at: number | null;
};

export type MemberLifestyleStatsResponse = {
  ok: boolean;
  period: {
    start_date: string;
    end_date: string;
    days: number;
    max_days: number;
    capped: boolean;
  };
  summary: {
    members: number;
    total_overdosed: number;
    total_xantaken: number;
    average_xantaken: number;
    adjusted_average_xantaken: number;
    average_refills: number;
    average_useractivity: number;
    average_networth: number;
    total_gymenergy: number;
    average_gymenergy: number;
    average_gymstrength: number;
    average_gymspeed: number;
    average_gymdefense: number;
    average_gymdexterity: number;
    oldest_updated_at: number | null;
  };
  members: MemberLifestyleStats[];
};

export type MemberLifestyleRefreshResponse = {
  ok: boolean;
  considered: number;
  refreshed: number;
  failed: number;
  gym_contributors?: {
    refreshed_stats: number;
    updated_members: number;
    error?: string;
  };
};

export type AttackExportOptions = {
  warName: string;
  scope: "all" | "outgoing" | "war_relevant";
  startWindow: "official" | "practical" | "custom";
  finishWindow: "official" | "practical" | "custom";
  linkedStatus: "linked" | "matching" | "unlinked";
  columns: "standard" | "debug";
  customStart?: number;
  customFinish?: number;
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

export async function getWarActivity(
  warName: string,
  window: "practical" | "official" = "practical",
): Promise<WarActivityResponse> {
  return getJson<WarActivityResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity?bucket_minutes=15&window=${window}`,
  );
}

export async function getWarActivityHeatmap(
  warName: string,
): Promise<FactionActivityHeatmapResponse> {
  return getJson<FactionActivityHeatmapResponse>(
    `/api/wars/${encodeURIComponent(warName)}/activity-heatmap`,
  );
}

export async function getWarChainBonuses(warName: string): Promise<WarChainBonusesResponse> {
  return getJson<WarChainBonusesResponse>(
    `/api/wars/${encodeURIComponent(warName)}/chain-bonuses`,
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

export async function runIngestion(): Promise<unknown> {
  return postJson("/api/run");
}

export async function rebuildStats(): Promise<unknown> {
  return postJson("/api/rebuild");
}

export async function getLatestIngestionRun(): Promise<IngestionRunResponse> {
  return getJson<IngestionRunResponse>("/api/admin/ingestion-run", true);
}

export async function listAdminUsers(): Promise<unknown> {
  return getJson("/api/admin/users", true);
}

export async function grantAdminAccess(tornUserId: number): Promise<unknown> {
  return postJson("/api/admin/users/grant", { torn_user_id: tornUserId });
}

export async function getMemberLifestyleStats(options: {
  startDate?: string;
  endDate?: string;
} = {}): Promise<MemberLifestyleStatsResponse> {
  const params = new URLSearchParams();
  if (options.startDate) {
    params.set("start_date", options.startDate);
  }
  if (options.endDate) {
    params.set("end_date", options.endDate);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<MemberLifestyleStatsResponse>(`/api/member-lifestyle-stats${suffix}`);
}

export async function refreshMemberLifestyleStats(
  options: { limit?: number; force?: boolean } = {},
): Promise<MemberLifestyleRefreshResponse> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.force) {
    params.set("force", "true");
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return postJson<MemberLifestyleRefreshResponse>(`/api/member-lifestyle-stats/refresh${suffix}`);
}

export async function createWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars", payload);
}

export async function updateOfficialWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/update-official", payload);
}

export async function updateEvent(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/update-event", payload);
}

export async function importWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import", payload);
}

export async function importEvent(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import-event", payload);
}

export async function previewImportWar(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import/preview", {
    practical_start_time: payload.practical_start_time,
    practical_finish_time: payload.practical_finish_time,
    official_start_time: payload.official_start_time,
    official_end_time: payload.official_end_time,
    war_type: payload.war_type,
    torn_war_id: payload.torn_war_id,
  });
}

export async function previewImportEvent(payload: AdminWarPayload): Promise<unknown> {
  return postJson("/api/wars/import-event/preview", {
    practical_start_time: payload.practical_start_time,
    practical_finish_time: payload.practical_finish_time,
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

export async function endActiveWar(options: { practical_finish_time?: number } = {}): Promise<unknown> {
  return postJson(
    "/api/wars/end",
    options.practical_finish_time === undefined ? undefined : options,
  );
}

export async function fetchTornWarReport(tornWarId: number): Promise<unknown> {
  return postJson(`/api/torn-wars/${encodeURIComponent(tornWarId)}/report/fetch`);
}

export async function refreshEnemyScouting(warName: string): Promise<EnemyScoutingResponse> {
  return postJson<EnemyScoutingResponse>(
    `/api/wars/${encodeURIComponent(warName)}/enemy-scouting`,
  );
}

export async function exportWarAttacksCsv(options: AttackExportOptions): Promise<void> {
  const params = new URLSearchParams({
    format: "csv",
    scope: options.scope,
    start_window: options.startWindow,
    finish_window: options.finishWindow,
    linked_status: options.linkedStatus,
    columns: options.columns,
  });

  if (options.customStart !== undefined) {
    params.set("custom_start", String(options.customStart));
  }
  if (options.customFinish !== undefined) {
    params.set("custom_finish", String(options.customFinish));
  }

  const response = await fetch(
    `${API_BASE_URL}/api/wars/${encodeURIComponent(options.warName)}/attacks?${params.toString()}`,
    { headers: authHeaders(true) },
  );

  if (!response.ok) {
    const text = await response.text();
    let message = `Request failed: ${response.status}`;
    try {
      const data = JSON.parse(text);
      message = data.error ?? message;
    } catch {
      if (text.trim()) {
        message = text;
      }
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = filenameFromContentDisposition(disposition) ?? `${options.warName}-attacks.csv`;
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

async function getJson<T>(path: string, includeAuth = true): Promise<T> {
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

function filenameFromContentDisposition(value: string): string | null {
  const match = value.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

